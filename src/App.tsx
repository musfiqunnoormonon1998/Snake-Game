/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Trophy,
  Flame,
  Volume2,
  VolumeX,
  Play,
  RotateCcw,
  Pause,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Info,
  Download,
  Check,
  Zap,
  ShieldAlert,
} from 'lucide-react';
import { sounds } from './sound';

// Grid and Coordinate Types
interface Point {
  x: number;
  y: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
  alpha: number;
  life: number;
  maxLife: number;
}

interface ScorePopup {
  id: number;
  x: number;
  y: number;
  text: string;
  color: string;
}

type Direction = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';
type GameState = 'START' | 'PLAYING' | 'PAUSED' | 'GAME_OVER';
type Difficulty = 'CASUAL' | 'NORMAL' | 'FAST';

const GRID_SIZE = 20; // 20x20 grid
const CELL_SIZE = 22; // 22px per cell => 440px canvas
const CANVAS_DIM = GRID_SIZE * CELL_SIZE; // 440px

const SPEEDS: Record<Difficulty, number> = {
  CASUAL: 125,
  NORMAL: 90,
  FAST: 65,
};

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Game Core States
  const [gameState, setGameState] = useState<GameState>('START');
  const [score, setScore] = useState<number>(0);
  const [highScore, setHighScore] = useState<number>(() => {
    try {
      return parseInt(localStorage.getItem('snake_high_score') || '0', 10) || 0;
    } catch {
      return 0;
    }
  });
  const [isNewHighScore, setIsNewHighScore] = useState<boolean>(false);
  const [applesEaten, setApplesEaten] = useState<number>(0);
  const [goldenEaten, setGoldenEaten] = useState<number>(0);
  const [difficulty, setDifficulty] = useState<Difficulty>('NORMAL');
  const [isMuted, setIsMuted] = useState<boolean>(() => sounds.isMuted());
  const [wallMode, setWallMode] = useState<'SOLID' | 'PASS_THROUGH'>('SOLID');
  const [isShaking, setIsShaking] = useState<boolean>(false);
  const [scorePopups, setScorePopups] = useState<ScorePopup[]>([]);
  const [showExportModal, setShowExportModal] = useState<boolean>(false);
  const [copiedCode, setCopiedCode] = useState<boolean>(false);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);

  // Active key pressed visual feedback for mobile D-pad & keyboard
  const [activeControl, setActiveControl] = useState<Direction | null>(null);

  // References to keep mutable game loop data synchronized without stale closures
  const snakeRef = useRef<Point[]>([
    { x: 10, y: 10 },
    { x: 9, y: 10 },
    { x: 8, y: 10 },
  ]);
  const directionRef = useRef<Direction>('RIGHT');
  const inputQueueRef = useRef<Direction[]>([]);
  const foodRef = useRef<Point>({ x: 15, y: 10 });
  const goldenFoodRef = useRef<{ pos: Point; timeLeft: number } | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const gameStateRef = useRef<GameState>('START');
  const scoreRef = useRef<number>(0);
  const applesCountRef = useRef<number>(0);
  const lastTickTimeRef = useRef<number>(0);
  const animationFrameIdRef = useRef<number | null>(null);
  const timerIntervalRef = useRef<number | null>(null);

  // Keep ref synchronized with state
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  // Touch Swipe coordinates
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  // Sound toggle handler
  const handleToggleSound = () => {
    const muted = sounds.toggleMute();
    setIsMuted(muted);
  };

  // Helper: Generate non-overlapping random point
  const getRandomFreeCell = useCallback((): Point => {
    const occupied = new Set<string>();
    snakeRef.current.forEach((segment) => occupied.add(`${segment.x},${segment.y}`));
    if (foodRef.current) occupied.add(`${foodRef.current.x},${foodRef.current.y}`);
    if (goldenFoodRef.current) occupied.add(`${goldenFoodRef.current.pos.x},${goldenFoodRef.current.pos.y}`);

    const freeSpots: Point[] = [];
    for (let x = 0; x < GRID_SIZE; x++) {
      for (let y = 0; y < GRID_SIZE; y++) {
        if (!occupied.has(`${x},${y}`)) {
          freeSpots.push({ x, y });
        }
      }
    }

    if (freeSpots.length === 0) return { x: 0, y: 0 };
    const randomIndex = Math.floor(Math.random() * freeSpots.length);
    return freeSpots[randomIndex];
  }, []);

  // Spawn standard food
  const spawnFood = useCallback(() => {
    foodRef.current = getRandomFreeCell();
  }, [getRandomFreeCell]);

  // Spawn golden bonus item
  const maybeSpawnGoldenFood = useCallback(() => {
    if (goldenFoodRef.current) return;
    // 25% chance when eating regular food, or if applesCount is multiple of 5
    if (applesCountRef.current > 0 && (applesCountRef.current % 5 === 0 || Math.random() < 0.2)) {
      goldenFoodRef.current = {
        pos: getRandomFreeCell(),
        timeLeft: 60, // ~6 seconds lifespan
      };
    }
  }, [getRandomFreeCell]);

  // Particle burst generator
  const createExplosion = (x: number, y: number, color: string, count = 16) => {
    const px = x * CELL_SIZE + CELL_SIZE / 2;
    const py = y * CELL_SIZE + CELL_SIZE / 2;

    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
      const speed = Math.random() * 3 + 1.5;
      particlesRef.current.push({
        x: px,
        y: py,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color,
        size: Math.random() * 3.5 + 2,
        alpha: 1,
        life: 0,
        maxLife: Math.floor(Math.random() * 15 + 18),
      });
    }
  };

  // Add floating score label
  const addScorePopup = (cellX: number, cellY: number, text: string, color: string) => {
    const popup: ScorePopup = {
      id: Date.now() + Math.random(),
      x: cellX * CELL_SIZE + CELL_SIZE / 2,
      y: cellY * CELL_SIZE,
      text,
      color,
    };
    setScorePopups((prev) => [...prev, popup]);
    setTimeout(() => {
      setScorePopups((prev) => prev.filter((p) => p.id !== popup.id));
    }, 800);
  };

  // Screen shake on collision
  const triggerShake = () => {
    setIsShaking(true);
    setTimeout(() => setIsShaking(false), 380);
  };

  // Start / Restart Game
  const startGame = useCallback(() => {
    snakeRef.current = [
      { x: 10, y: 10 },
      { x: 9, y: 10 },
      { x: 8, y: 10 },
    ];
    directionRef.current = 'RIGHT';
    inputQueueRef.current = [];
    foodRef.current = { x: 15, y: 10 };
    goldenFoodRef.current = null;
    particlesRef.current = [];
    scoreRef.current = 0;
    applesCountRef.current = 0;

    setScore(0);
    setApplesEaten(0);
    setGoldenEaten(0);
    setIsNewHighScore(false);
    setElapsedSeconds(0);
    setGameState('PLAYING');
    sounds.playStart();

    // Start timer
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    timerIntervalRef.current = window.setInterval(() => {
      if (gameStateRef.current === 'PLAYING') {
        setElapsedSeconds((s) => s + 1);
      }
    }, 1000);
  }, []);

  // Pause / Resume Game
  const togglePause = useCallback(() => {
    if (gameStateRef.current === 'PLAYING') {
      setGameState('PAUSED');
      sounds.playPause();
    } else if (gameStateRef.current === 'PAUSED') {
      setGameState('PLAYING');
      sounds.playPause();
    }
  }, []);

  // Safe direction handler with input buffer
  const queueDirection = useCallback((newDir: Direction) => {
    if (gameStateRef.current !== 'PLAYING') return;

    // Trigger visual touch feedback
    setActiveControl(newDir);
    setTimeout(() => setActiveControl(null), 120);

    const opposites: Record<Direction, Direction> = {
      UP: 'DOWN',
      DOWN: 'UP',
      LEFT: 'RIGHT',
      RIGHT: 'LEFT',
    };

    const queue = inputQueueRef.current;
    // Determine last planned direction in queue or current direction
    const lastDir = queue.length > 0 ? queue[queue.length - 1] : directionRef.current;

    // Ignore exact duplicates or direct opposites (to prevent instant suicide)
    if (newDir !== lastDir && newDir !== opposites[lastDir]) {
      // Max buffer size of 2 to keep controls snappy
      if (queue.length < 2) {
        queue.push(newDir);
        sounds.playTurn();
      }
    }
  }, []);

  // Keyboard navigation listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Prevent default scrolling on arrow keys and spacebar
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
        e.preventDefault();
      }

      if (e.key === ' ' || e.key === 'p' || e.key === 'P') {
        if (gameStateRef.current === 'PLAYING' || gameStateRef.current === 'PAUSED') {
          togglePause();
          return;
        } else if (gameStateRef.current === 'START' || gameStateRef.current === 'GAME_OVER') {
          startGame();
          return;
        }
      }

      switch (e.key) {
        case 'ArrowUp':
        case 'w':
        case 'W':
          queueDirection('UP');
          break;
        case 'ArrowDown':
        case 's':
        case 'S':
          queueDirection('DOWN');
          break;
        case 'ArrowLeft':
        case 'a':
        case 'A':
          queueDirection('LEFT');
          break;
        case 'ArrowRight':
        case 'd':
        case 'D':
          queueDirection('RIGHT');
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [queueDirection, togglePause, startGame]);

  // Touch handlers for swipe controls on canvas
  const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (!touchStartRef.current) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - touchStartRef.current.x;
    const dy = touch.clientY - touchStartRef.current.y;
    touchStartRef.current = null;

    const minSwipeDistance = 25;
    if (Math.abs(dx) > Math.abs(dy)) {
      if (Math.abs(dx) > minSwipeDistance) {
        queueDirection(dx > 0 ? 'RIGHT' : 'LEFT');
      }
    } else {
      if (Math.abs(dy) > minSwipeDistance) {
        queueDirection(dy > 0 ? 'DOWN' : 'UP');
      }
    }
  };

  // Main Game Logic Update Tick
  const updateGameTick = useCallback(() => {
    if (gameStateRef.current !== 'PLAYING') return;

    // Apply next queued direction
    if (inputQueueRef.current.length > 0) {
      directionRef.current = inputQueueRef.current.shift()!;
    }

    const currentHead = snakeRef.current[0];
    const newHead: Point = { ...currentHead };

    switch (directionRef.current) {
      case 'UP':
        newHead.y -= 1;
        break;
      case 'DOWN':
        newHead.y += 1;
        break;
      case 'LEFT':
        newHead.x -= 1;
        break;
      case 'RIGHT':
        newHead.x += 1;
        break;
    }

    // Wall collision checking or wrap-around
    if (wallMode === 'PASS_THROUGH') {
      if (newHead.x < 0) newHead.x = GRID_SIZE - 1;
      else if (newHead.x >= GRID_SIZE) newHead.x = 0;
      if (newHead.y < 0) newHead.y = GRID_SIZE - 1;
      else if (newHead.y >= GRID_SIZE) newHead.y = 0;
    } else {
      // Solid Wall Collision
      if (newHead.x < 0 || newHead.x >= GRID_SIZE || newHead.y < 0 || newHead.y >= GRID_SIZE) {
        handleGameOver('wall');
        return;
      }
    }

    // Self collision checking (excluding tail if it moves)
    const selfHit = snakeRef.current.slice(0, -1).some((segment) => segment.x === newHead.x && segment.y === newHead.y);
    if (selfHit) {
      handleGameOver('self');
      return;
    }

    // Check eating standard food
    const ateRegularFood = newHead.x === foodRef.current.x && newHead.y === foodRef.current.y;

    // Check eating golden food
    const ateGoldenFood =
      goldenFoodRef.current &&
      newHead.x === goldenFoodRef.current.pos.x &&
      newHead.y === goldenFoodRef.current.pos.y;

    // Advance snake
    const newSnake = [newHead, ...snakeRef.current];

    if (ateRegularFood) {
      sounds.playEat();
      const points = 10;
      scoreRef.current += points;
      applesCountRef.current += 1;
      setScore(scoreRef.current);
      setApplesEaten(applesCountRef.current);

      createExplosion(foodRef.current.x, foodRef.current.y, '#10b981', 14);
      addScorePopup(foodRef.current.x, foodRef.current.y, `+${points}`, '#10b981');

      spawnFood();
      maybeSpawnGoldenFood();
    } else if (ateGoldenFood) {
      sounds.playBonus();
      const bonusPoints = 50;
      scoreRef.current += bonusPoints;
      setScore(scoreRef.current);
      setGoldenEaten((g) => g + 1);

      createExplosion(goldenFoodRef.current!.pos.x, goldenFoodRef.current!.pos.y, '#f59e0b', 24);
      addScorePopup(goldenFoodRef.current!.pos.x, goldenFoodRef.current!.pos.y, `+${bonusPoints}!`, '#f59e0b');

      goldenFoodRef.current = null;
    } else {
      // If no food eaten, remove tail segment
      newSnake.pop();
    }

    // Handle golden food expiration timer
    if (goldenFoodRef.current) {
      goldenFoodRef.current.timeLeft -= 1;
      if (goldenFoodRef.current.timeLeft <= 0) {
        goldenFoodRef.current = null;
      }
    }

    snakeRef.current = newSnake;

    // Check for high score updates in real-time
    if (scoreRef.current > highScore) {
      setHighScore(scoreRef.current);
      setIsNewHighScore(true);
      try {
        localStorage.setItem('snake_high_score', String(scoreRef.current));
      } catch {
        // ignore
      }
    }
  }, [wallMode, highScore, spawnFood, maybeSpawnGoldenFood]);

  // Handle Game Over
  const handleGameOver = (_reason: 'wall' | 'self') => {
    sounds.playCrash();
    triggerShake();
    setGameState('GAME_OVER');

    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }

    // Final high score check
    if (scoreRef.current > highScore) {
      setHighScore(scoreRef.current);
      setIsNewHighScore(true);
      try {
        localStorage.setItem('snake_high_score', String(scoreRef.current));
      } catch {
        // ignore
      }
    }
  };

  // Rendering Loop on HTML5 Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // High DPI scaling
    const dpr = window.devicePixelRatio || 1;
    canvas.width = CANVAS_DIM * dpr;
    canvas.height = CANVAS_DIM * dpr;
    ctx.scale(dpr, dpr);

    let animationId: number;

    const render = (timestamp: number) => {
      // Check tick interval for game logic
      const tickSpeed = SPEEDS[difficulty];
      if (gameStateRef.current === 'PLAYING') {
        if (!lastTickTimeRef.current) lastTickTimeRef.current = timestamp;
        const elapsed = timestamp - lastTickTimeRef.current;

        if (elapsed >= tickSpeed) {
          lastTickTimeRef.current = timestamp;
          updateGameTick();
        }
      }

      // Clear Canvas
      ctx.clearRect(0, 0, CANVAS_DIM, CANVAS_DIM);

      // Background gradient
      const bgGrad = ctx.createLinearGradient(0, 0, CANVAS_DIM, CANVAS_DIM);
      bgGrad.addColorStop(0, '#090d16');
      bgGrad.addColorStop(1, '#05080f');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, CANVAS_DIM, CANVAS_DIM);

      // Draw subtle grid lines
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.035)';
      for (let i = 0; i <= GRID_SIZE; i++) {
        const pos = i * CELL_SIZE;
        ctx.beginPath();
        ctx.moveTo(pos, 0);
        ctx.lineTo(pos, CANVAS_DIM);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(0, pos);
        ctx.lineTo(CANVAS_DIM, pos);
        ctx.stroke();
      }

      // Draw subtle outer border glow
      ctx.strokeStyle = wallMode === 'SOLID' ? 'rgba(16, 185, 129, 0.25)' : 'rgba(56, 189, 248, 0.25)';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, CANVAS_DIM - 2, CANVAS_DIM - 2);

      // Pulsing pulse value for food breathing
      const pulse = Math.sin(timestamp / 160) * 0.25 + 1; // 0.75 - 1.25

      // 1. Draw Regular Food (Pulsing glowing ruby apple)
      const food = foodRef.current;
      if (food) {
        const fx = food.x * CELL_SIZE + CELL_SIZE / 2;
        const fy = food.y * CELL_SIZE + CELL_SIZE / 2;
        const r = (CELL_SIZE / 2 - 2) * pulse;

        ctx.save();
        // Glow effect
        ctx.shadowColor = '#f43f5e';
        ctx.shadowBlur = 14 * pulse;

        // Apple body gradient
        const appleGrad = ctx.createRadialGradient(fx - 2, fy - 2, 1, fx, fy, r);
        appleGrad.addColorStop(0, '#fb7185');
        appleGrad.addColorStop(0.6, '#e11d48');
        appleGrad.addColorStop(1, '#9f1239');

        ctx.fillStyle = appleGrad;
        ctx.beginPath();
        ctx.arc(fx, fy, Math.max(2, r), 0, Math.PI * 2);
        ctx.fill();

        // Specular highlight glint
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
        ctx.beginPath();
        ctx.arc(fx - r * 0.35, fy - r * 0.35, r * 0.25, 0, Math.PI * 2);
        ctx.fill();

        // Stem & Leaf
        ctx.strokeStyle = '#854d0e';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(fx, fy - r);
        ctx.quadraticCurveTo(fx + 2, fy - r - 4, fx + 1, fy - r - 5);
        ctx.stroke();

        ctx.fillStyle = '#22c55e';
        ctx.beginPath();
        ctx.ellipse(fx + 3, fy - r - 3, 2.5, 1.2, Math.PI / 4, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
      }

      // 2. Draw Golden Bonus Food if active
      if (goldenFoodRef.current) {
        const gf = goldenFoodRef.current;
        const gx = gf.pos.x * CELL_SIZE + CELL_SIZE / 2;
        const gy = gf.pos.y * CELL_SIZE + CELL_SIZE / 2;
        const starPulse = Math.sin(timestamp / 100) * 0.3 + 1;
        const radius = (CELL_SIZE / 2 - 1) * starPulse;

        ctx.save();
        ctx.shadowColor = '#eab308';
        ctx.shadowBlur = 20 * starPulse;

        // Golden circular aura
        const starGrad = ctx.createRadialGradient(gx, gy, 1, gx, gy, radius);
        starGrad.addColorStop(0, '#fef08a');
        starGrad.addColorStop(0.6, '#eab308');
        starGrad.addColorStop(1, '#a16207');

        ctx.fillStyle = starGrad;
        ctx.beginPath();
        ctx.arc(gx, gy, Math.max(3, radius), 0, Math.PI * 2);
        ctx.fill();

        // Rotating golden sparkles
        const rot = timestamp / 300;
        ctx.fillStyle = '#ffffff';
        ctx.shadowBlur = 4;
        ctx.shadowColor = '#ffffff';
        for (let i = 0; i < 4; i++) {
          const a = rot + (i * Math.PI) / 2;
          const sx = gx + Math.cos(a) * (radius * 0.7);
          const sy = gy + Math.sin(a) * (radius * 0.7);
          ctx.beginPath();
          ctx.arc(sx, sy, 1.5, 0, Math.PI * 2);
          ctx.fill();
        }

        // Timer ring around golden apple
        const maxTime = 60;
        const fraction = Math.max(0, gf.timeLeft / maxTime);
        ctx.strokeStyle = '#fef08a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(gx, gy, CELL_SIZE / 2 + 3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * fraction);
        ctx.stroke();

        ctx.restore();
      }

      // 3. Draw Snake with sleek gradients, rounded body segments & expressive head
      const snake = snakeRef.current;
      const snakeLength = snake.length;

      for (let i = snakeLength - 1; i >= 0; i--) {
        const segment = snake[i];
        const sx = segment.x * CELL_SIZE;
        const sy = segment.y * CELL_SIZE;
        const isHead = i === 0;

        ctx.save();

        if (isHead) {
          // Snake Head with directional eyes
          ctx.shadowColor = '#10b981';
          ctx.shadowBlur = 12;

          const headGrad = ctx.createLinearGradient(sx, sy, sx + CELL_SIZE, sy + CELL_SIZE);
          headGrad.addColorStop(0, '#34d399');
          headGrad.addColorStop(1, '#059669');
          ctx.fillStyle = headGrad;

          // Rounded rectangle head
          const pad = 1.5;
          const cornerRadius = 6;
          drawRoundedRect(
            ctx,
            sx + pad,
            sy + pad,
            CELL_SIZE - pad * 2,
            CELL_SIZE - pad * 2,
            cornerRadius
          );
          ctx.fill();

          // Head inner highlight
          ctx.shadowBlur = 0;
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
          ctx.lineWidth = 1;
          drawRoundedRect(
            ctx,
            sx + pad + 1,
            sy + pad + 1,
            CELL_SIZE - pad * 2 - 2,
            CELL_SIZE - pad * 2 - 2,
            cornerRadius - 1
          );
          ctx.stroke();

          // Expressive Eyes facing movement direction
          const dir = directionRef.current;
          let eye1 = { x: 0, y: 0 };
          let eye2 = { x: 0, y: 0 };
          let pupilOffset = { x: 0, y: 0 };

          const cx = sx + CELL_SIZE / 2;
          const cy = sy + CELL_SIZE / 2;

          if (dir === 'RIGHT') {
            eye1 = { x: cx + 4, y: cy - 4.5 };
            eye2 = { x: cx + 4, y: cy + 4.5 };
            pupilOffset = { x: 1.2, y: 0 };
          } else if (dir === 'LEFT') {
            eye1 = { x: cx - 4, y: cy - 4.5 };
            eye2 = { x: cx - 4, y: cy + 4.5 };
            pupilOffset = { x: -1.2, y: 0 };
          } else if (dir === 'UP') {
            eye1 = { x: cx - 4.5, y: cy - 4 };
            eye2 = { x: cx + 4.5, y: cy - 4 };
            pupilOffset = { x: 0, y: -1.2 };
          } else if (dir === 'DOWN') {
            eye1 = { x: cx - 4.5, y: cy + 4 };
            eye2 = { x: cx + 4.5, y: cy + 4 };
            pupilOffset = { x: 0, y: 1.2 };
          }

          // Eye sclera
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(eye1.x, eye1.y, 2.8, 0, Math.PI * 2);
          ctx.arc(eye2.x, eye2.y, 2.8, 0, Math.PI * 2);
          ctx.fill();

          // Pupils
          ctx.fillStyle = '#0f172a';
          ctx.beginPath();
          ctx.arc(eye1.x + pupilOffset.x, eye1.y + pupilOffset.y, 1.5, 0, Math.PI * 2);
          ctx.arc(eye2.x + pupilOffset.x, eye2.y + pupilOffset.y, 1.5, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // Snake Body: Smooth gradient progression from neon emerald to cyan
          const t = i / snakeLength; // 0 (near head) to 1 (tail)

          // Interpolate color: emerald-400 (#34d399) to cyan-500 (#06b6d4)
          ctx.shadowColor = 'rgba(16, 185, 129, 0.4)';
          ctx.shadowBlur = 4;

          // Body gradient
          const bodyGrad = ctx.createRadialGradient(
            sx + CELL_SIZE / 2,
            sy + CELL_SIZE / 2,
            1,
            sx + CELL_SIZE / 2,
            sy + CELL_SIZE / 2,
            CELL_SIZE / 2
          );

          if (t < 0.5) {
            bodyGrad.addColorStop(0, '#10b981');
            bodyGrad.addColorStop(1, '#059669');
          } else {
            bodyGrad.addColorStop(0, '#06b6d4');
            bodyGrad.addColorStop(1, '#0284c7');
          }

          ctx.fillStyle = bodyGrad;

          // Taper tail slightly
          const pad = isHead ? 1.5 : 2 + (i === snakeLength - 1 ? 2.5 : 0);
          const corner = isHead ? 6 : Math.max(3, 5 - (i / snakeLength) * 2);

          drawRoundedRect(
            ctx,
            sx + pad,
            sy + pad,
            CELL_SIZE - pad * 2,
            CELL_SIZE - pad * 2,
            corner
          );
          ctx.fill();

          // Subtle center scales / shine dot
          ctx.shadowBlur = 0;
          ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
          ctx.beginPath();
          ctx.arc(sx + CELL_SIZE / 2, sy + CELL_SIZE / 2, 1.5, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.restore();
      }

      // 4. Update and render food burst particles
      const particles = particlesRef.current;
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.94;
        p.vy *= 0.94;
        p.life += 1;
        p.alpha = 1 - p.life / p.maxLife;

        if (p.alpha <= 0) {
          particles.splice(i, 1);
          continue;
        }

        ctx.save();
        ctx.globalAlpha = Math.max(0, p.alpha);
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // 5. Draw Live On-Canvas Score HUD directly in game area
      if (gameStateRef.current === 'PLAYING' || gameStateRef.current === 'PAUSED') {
        ctx.save();
        // Translucent dark gradient HUD bar at top of canvas
        const hudGrad = ctx.createLinearGradient(0, 0, 0, 32);
        hudGrad.addColorStop(0, 'rgba(6, 10, 18, 0.85)');
        hudGrad.addColorStop(1, 'rgba(6, 10, 18, 0.4)');
        ctx.fillStyle = hudGrad;
        ctx.fillRect(0, 0, CANVAS_DIM, 32);

        // Hairline divider
        ctx.strokeStyle = 'rgba(52, 211, 153, 0.2)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, 32);
        ctx.lineTo(CANVAS_DIM, 32);
        ctx.stroke();

        // Pulsing Live Indicator
        const pulseAlpha = Math.sin(timestamp / 180) * 0.35 + 0.65;
        ctx.fillStyle = `rgba(52, 211, 153, ${pulseAlpha})`;
        ctx.beginPath();
        ctx.arc(14, 16, 3.5, 0, Math.PI * 2);
        ctx.fill();

        // Live Score Text
        ctx.font = '700 13px "JetBrains Mono", monospace';
        ctx.fillStyle = '#34d399';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(52, 211, 153, 0.5)';
        ctx.shadowBlur = 8;
        ctx.fillText(`LIVE: ${scoreRef.current}`, 24, 16);
        ctx.shadowBlur = 0;

        // Middle metric: Apples
        ctx.font = '600 11px "Outfit", sans-serif';
        ctx.fillStyle = '#94a3b8';
        ctx.textAlign = 'center';
        ctx.fillText(`APPLES: ${applesCountRef.current}`, CANVAS_DIM / 2, 16);

        // Right metric: High Score (offset for pause button)
        ctx.textAlign = 'right';
        ctx.font = '700 12px "JetBrains Mono", monospace';
        const isCurrentLeader = scoreRef.current >= highScore && scoreRef.current > 0;
        ctx.fillStyle = isCurrentLeader ? '#fbbf24' : '#64748b';
        ctx.fillText(isCurrentLeader ? `★ RECORD` : `BEST: ${highScore}`, CANVAS_DIM - 42, 16);

        ctx.restore();
      }

      animationId = requestAnimationFrame(render);
    };

    animationId = requestAnimationFrame(render);
    animationFrameIdRef.current = animationId;

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [difficulty, updateGameTick, wallMode]);

  // Rounded rectangle helper
  function drawRoundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  // Format MM:SS
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Generate self-contained single-file HTML code for export/copy
  const getSingleHtmlSourceCode = () => {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Neon Serpent - Modern Arcade Snake Game</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;700&family=Outfit:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; -webkit-user-select: none; }
    body {
      background: #060a12;
      color: #e2e8f0;
      font-family: 'Outfit', sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 16px;
      overflow-x: hidden;
    }
    .game-wrapper {
      width: 100%;
      max-width: 480px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
    }
    .header-bar {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 4px;
    }
    .brand-title {
      font-size: 22px;
      font-weight: 800;
      letter-spacing: -0.5px;
      background: linear-gradient(135deg, #34d399 0%, #06b6d4 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .icon-btn {
      background: #0f172a;
      border: 1px solid #1e293b;
      color: #94a3b8;
      padding: 8px 12px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 13px;
      font-family: inherit;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s ease;
    }
    .icon-btn:hover { background: #1e293b; color: #f8fafc; border-color: #334155; }
    .scoreboard {
      width: 100%;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .score-card {
      background: #0b1120;
      border: 1px solid #1e293b;
      border-radius: 12px;
      padding: 12px 16px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    }
    .score-label {
      font-size: 12px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #64748b;
    }
    .score-val {
      font-family: 'JetBrains Mono', monospace;
      font-size: 26px;
      font-weight: 700;
      color: #f8fafc;
    }
    .score-val.highlight {
      color: #34d399;
      text-shadow: 0 0 10px rgba(52, 211, 153, 0.4);
    }
    .canvas-container {
      position: relative;
      width: 100%;
      aspect-ratio: 1 / 1;
      max-width: 440px;
      border-radius: 16px;
      overflow: hidden;
      background: #070b14;
      border: 1px solid #1e293b;
      box-shadow: 0 0 30px rgba(16, 185, 129, 0.1), 0 10px 25px rgba(0, 0, 0, 0.6);
    }
    canvas {
      width: 100%;
      height: 100%;
      display: block;
    }
    .overlay {
      position: absolute;
      inset: 0;
      background: rgba(6, 10, 18, 0.85);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px;
      text-align: center;
      z-index: 10;
    }
    .overlay.hidden { display: none; }
    .overlay-title {
      font-size: 28px;
      font-weight: 800;
      color: #f8fafc;
      margin-bottom: 8px;
    }
    .overlay-desc {
      font-size: 14px;
      color: #94a3b8;
      margin-bottom: 24px;
      line-height: 1.5;
    }
    .btn-primary {
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      color: #ffffff;
      border: none;
      padding: 12px 28px;
      border-radius: 10px;
      font-size: 15px;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      box-shadow: 0 0 20px rgba(16, 185, 129, 0.4);
      transition: all 0.15s ease;
    }
    .btn-primary:hover {
      transform: translateY(-1px);
      box-shadow: 0 0 25px rgba(16, 185, 129, 0.6);
    }
    .dpad-container {
      width: 100%;
      max-width: 240px;
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      grid-template-rows: repeat(3, 1fr);
      gap: 8px;
      margin-top: 8px;
    }
    .dpad-btn {
      background: #0f172a;
      border: 1px solid #1e293b;
      color: #cbd5e1;
      height: 54px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      cursor: pointer;
      transition: all 0.1s ease;
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
    }
    .dpad-btn:active {
      background: #10b981;
      color: #ffffff;
      transform: scale(0.95);
      box-shadow: 0 0 16px rgba(16, 185, 129, 0.6);
    }
    .dpad-up { grid-column: 2; grid-row: 1; }
    .dpad-left { grid-column: 1; grid-row: 2; }
    .dpad-down { grid-column: 2; grid-row: 2; }
    .dpad-right { grid-column: 3; grid-row: 2; }
    .instructions-bar {
      font-size: 12px;
      color: #64748b;
      text-align: center;
      margin-top: 4px;
    }
  </style>
</head>
<body>
  <div class="game-wrapper">
    <div class="header-bar">
      <div class="brand-title">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        NEON SERPENT
      </div>
      <button id="soundToggle" class="icon-btn">Sound: ON</button>
    </div>

    <div class="scoreboard">
      <div class="score-card">
        <span class="score-label" style="display:flex;align-items:center;gap:6px;color:#34d399;">
          <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#34d399;box-shadow:0 0 8px #34d399;"></span>
          LIVE SCORE
        </span>
        <span id="scoreDisplay" class="score-val highlight">0</span>
      </div>
      <div class="score-card">
        <span class="score-label">BEST RECORD</span>
        <span id="highScoreDisplay" class="score-val">0</span>
      </div>
    </div>

    <div class="canvas-container">
      <canvas id="gameCanvas" width="440" height="440"></canvas>

      <!-- Start Screen -->
      <div id="startOverlay" class="overlay">
        <div class="overlay-title">Ready to Glide?</div>
        <div class="overlay-desc">Use Arrow Keys or WASD to guide the snake.<br>Collect glowing orbs and stay clear of walls!</div>
        <button id="startBtn" class="btn-primary">START GAME</button>
      </div>

      <!-- Game Over Screen -->
      <div id="gameOverOverlay" class="overlay hidden">
        <div class="overlay-title" style="color: #f43f5e;">GAME OVER</div>
        <div class="overlay-desc" id="gameOverScoreText">Final Score: 0</div>
        <button id="restartBtn" class="btn-primary">PLAY AGAIN</button>
      </div>
    </div>

    <!-- Mobile Virtual D-Pad -->
    <div class="dpad-container">
      <button class="dpad-btn dpad-up" id="btnUp">▲</button>
      <button class="dpad-btn dpad-left" id="btnLeft">◀</button>
      <button class="dpad-btn dpad-down" id="btnDown">▼</button>
      <button class="dpad-btn dpad-right" id="btnRight">▶</button>
    </div>

    <div class="instructions-bar">
      Desktop: Arrow Keys / WASD · Space to Pause · Mobile: Touch D-Pad or Swipe
    </div>
  </div>

  <script>
    // Audio Synthesizer via Web Audio API
    class RetroAudio {
      constructor() {
        this.ctx = null;
        this.muted = false;
      }
      init() {
        if (!this.ctx) {
          const AudioCtx = window.AudioContext || window.webkitAudioContext;
          if (AudioCtx) this.ctx = new AudioCtx();
        }
        if (this.ctx && this.ctx.state === 'suspended') {
          this.ctx.resume();
        }
      }
      playEat() {
        if (this.muted) return;
        this.init();
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.08);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.12);
      }
      playCrash() {
        if (this.muted) return;
        this.init();
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(180, now);
        osc.frequency.exponentialRampToValueAtTime(40, now + 0.35);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.4);
      }
    }

    const audio = new RetroAudio();
    const GRID_SIZE = 20;
    const CELL_SIZE = 22;
    const CANVAS_SIZE = GRID_SIZE * CELL_SIZE;

    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    const scoreDisplay = document.getElementById('scoreDisplay');
    const highScoreDisplay = document.getElementById('highScoreDisplay');
    const startOverlay = document.getElementById('startOverlay');
    const gameOverOverlay = document.getElementById('gameOverOverlay');
    const gameOverScoreText = document.getElementById('gameOverScoreText');
    const startBtn = document.getElementById('startBtn');
    const restartBtn = document.getElementById('restartBtn');
    const soundToggle = document.getElementById('soundToggle');

    let highScore = parseInt(localStorage.getItem('snake_high_score') || '0', 10);
    highScoreDisplay.textContent = highScore;

    let snake = [];
    let direction = 'RIGHT';
    let inputQueue = [];
    let food = { x: 15, y: 10 };
    let score = 0;
    let isPlaying = false;
    let particles = [];
    let lastTickTime = 0;
    const TICK_SPEED = 90;

    function resetGame() {
      snake = [
        { x: 10, y: 10 },
        { x: 9, y: 10 },
        { x: 8, y: 10 }
      ];
      direction = 'RIGHT';
      inputQueue = [];
      score = 0;
      scoreDisplay.textContent = '0';
      particles = [];
      spawnFood();
      isPlaying = true;
      startOverlay.classList.add('hidden');
      gameOverOverlay.classList.add('hidden');
    }

    function spawnFood() {
      let valid = false;
      while (!valid) {
        food = {
          x: Math.floor(Math.random() * GRID_SIZE),
          y: Math.floor(Math.random() * GRID_SIZE)
        };
        valid = !snake.some(segment => segment.x === food.x && segment.y === food.y);
      }
    }

    function queueDirection(newDir) {
      if (!isPlaying) return;
      const opposites = { UP: 'DOWN', DOWN: 'UP', LEFT: 'RIGHT', RIGHT: 'LEFT' };
      const lastDir = inputQueue.length > 0 ? inputQueue[inputQueue.length - 1] : direction;
      if (newDir !== lastDir && newDir !== opposites[lastDir]) {
        if (inputQueue.length < 2) inputQueue.push(newDir);
      }
    }

    function update() {
      if (inputQueue.length > 0) {
        direction = inputQueue.shift();
      }

      const head = { ...snake[0] };
      if (direction === 'UP') head.y -= 1;
      else if (direction === 'DOWN') head.y += 1;
      else if (direction === 'LEFT') head.x -= 1;
      else if (direction === 'RIGHT') head.x += 1;

      // Wall collision
      if (head.x < 0 || head.x >= GRID_SIZE || head.y < 0 || head.y >= GRID_SIZE) {
        gameOver();
        return;
      }

      // Self collision
      if (snake.some(segment => segment.x === head.x && segment.y === head.y)) {
        gameOver();
        return;
      }

      snake.unshift(head);

      // Check eating food
      if (head.x === food.x && head.y === food.y) {
        audio.playEat();
        score += 10;
        scoreDisplay.textContent = score;
        if (score > highScore) {
          highScore = score;
          highScoreDisplay.textContent = highScore;
          localStorage.setItem('snake_high_score', highScore);
        }
        createBurst(food.x * CELL_SIZE + CELL_SIZE/2, food.y * CELL_SIZE + CELL_SIZE/2);
        spawnFood();
      } else {
        snake.pop();
      }
    }

    function gameOver() {
      isPlaying = false;
      audio.playCrash();
      gameOverScoreText.textContent = 'Final Score: ' + score;
      gameOverOverlay.classList.remove('hidden');
    }

    function createBurst(x, y) {
      for (let i = 0; i < 14; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 3 + 1;
        particles.push({
          x, y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          alpha: 1,
          size: Math.random() * 3 + 2
        });
      }
    }

    function draw(timestamp) {
      if (isPlaying) {
        if (timestamp - lastTickTime >= TICK_SPEED) {
          lastTickTime = timestamp;
          update();
        }
      }

      // Background
      ctx.fillStyle = '#070b14';
      ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

      // Subtle Grid lines
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
      ctx.lineWidth = 1;
      for (let i = 0; i <= GRID_SIZE; i++) {
        ctx.beginPath();
        ctx.moveTo(i * CELL_SIZE, 0);
        ctx.lineTo(i * CELL_SIZE, CANVAS_SIZE);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, i * CELL_SIZE);
        ctx.lineTo(CANVAS_SIZE, i * CELL_SIZE);
        ctx.stroke();
      }

      // Food with pulse glow
      const pulse = Math.sin(timestamp / 160) * 0.2 + 1;
      const fx = food.x * CELL_SIZE + CELL_SIZE / 2;
      const fy = food.y * CELL_SIZE + CELL_SIZE / 2;
      const r = (CELL_SIZE / 2 - 2) * pulse;

      ctx.save();
      ctx.shadowColor = '#f43f5e';
      ctx.shadowBlur = 14 * pulse;
      ctx.fillStyle = '#f43f5e';
      ctx.beginPath();
      ctx.arc(fx, fy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Snake with gradients and rounded segments
      for (let i = snake.length - 1; i >= 0; i--) {
        const seg = snake[i];
        const sx = seg.x * CELL_SIZE;
        const sy = seg.y * CELL_SIZE;
        const isHead = i === 0;

        ctx.save();
        if (isHead) {
          ctx.shadowColor = '#10b981';
          ctx.shadowBlur = 10;
          ctx.fillStyle = '#34d399';
        } else {
          ctx.fillStyle = i % 2 === 0 ? '#10b981' : '#06b6d4';
        }

        // Draw rounded box
        const pad = isHead ? 1 : 2;
        ctx.beginPath();
        ctx.roundRect(sx + pad, sy + pad, CELL_SIZE - pad * 2, CELL_SIZE - pad * 2, isHead ? 6 : 4);
        ctx.fill();
        ctx.restore();
      }

      // Particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.alpha -= 0.05;
        if (p.alpha <= 0) {
          particles.splice(i, 1);
          continue;
        }
        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = '#10b981';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Live on-canvas HUD bar
      if (isPlaying) {
        ctx.save();
        ctx.fillStyle = 'rgba(6, 10, 18, 0.78)';
        ctx.fillRect(0, 0, CANVAS_SIZE, 26);
        ctx.strokeStyle = 'rgba(52, 211, 153, 0.2)';
        ctx.strokeRect(0, 0, CANVAS_SIZE, 26);

        ctx.fillStyle = '#34d399';
        ctx.font = '700 12px "JetBrains Mono", monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('LIVE: ' + score, 12, 13);

        ctx.textAlign = 'right';
        ctx.font = '700 11px "JetBrains Mono", monospace';
        ctx.fillStyle = score >= highScore && score > 0 ? '#fbbf24' : '#64748b';
        ctx.fillText(score >= highScore && score > 0 ? '★ RECORD' : 'BEST: ' + highScore, CANVAS_SIZE - 12, 13);
        ctx.restore();
      }

      requestAnimationFrame(draw);
    }

    // Key listeners
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
        e.preventDefault();
      }
      if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') queueDirection('UP');
      else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') queueDirection('DOWN');
      else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') queueDirection('LEFT');
      else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') queueDirection('RIGHT');
    });

    // Touch D-Pad buttons
    document.getElementById('btnUp').addEventListener('click', () => queueDirection('UP'));
    document.getElementById('btnDown').addEventListener('click', () => queueDirection('DOWN'));
    document.getElementById('btnLeft').addEventListener('click', () => queueDirection('LEFT'));
    document.getElementById('btnRight').addEventListener('click', () => queueDirection('RIGHT'));

    startBtn.addEventListener('click', resetGame);
    restartBtn.addEventListener('click', resetGame);

    soundToggle.addEventListener('click', () => {
      audio.muted = !audio.muted;
      soundToggle.textContent = audio.muted ? 'Sound: OFF' : 'Sound: ON';
    });

    requestAnimationFrame(draw);
  </script>
</body>
</html>`;
  };

  const handleDownloadHtml = () => {
    const code = getSingleHtmlSourceCode();
    const blob = new Blob([code], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'neon-serpent-snake-game.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(getSingleHtmlSourceCode());
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      // Fallback
    }
  };

  return (
    <div className={`min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-3 sm:p-6 transition-all ${isShaking ? 'animate-screen-shake' : ''}`}>
      {/* Outer Game Container */}
      <div className="w-full max-w-[480px] flex flex-col items-center gap-4">
        
        {/* Top Bar with Brand and Utilities */}
        <header className="w-full flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-sm shadow-emerald-500/20">
              <Zap className="w-4 h-4 fill-emerald-400/20" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400 bg-clip-text text-transparent">
                NEON SERPENT
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleToggleSound}
              aria-label={isMuted ? 'Unmute game audio' : 'Mute game audio'}
              className="p-2 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
              title={isMuted ? 'Sound Off' : 'Sound On'}
            >
              {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4 text-emerald-400" />}
            </button>

            <button
              onClick={() => setShowExportModal(true)}
              className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 text-xs font-medium text-slate-300 hover:text-white flex items-center gap-1.5 transition-colors"
              title="Export Standalone HTML file"
            >
              <Download className="w-3.5 h-3.5 text-cyan-400" />
              <span>Export HTML</span>
            </button>
          </div>
        </header>

        {/* Scoreboard Cards */}
        <div className="w-full grid grid-cols-3 gap-2.5">
          {/* Current Live Score */}
          <div className="bg-slate-900/90 border border-emerald-500/30 rounded-xl p-3 flex flex-col justify-between shadow-lg shadow-emerald-500/10 relative overflow-hidden">
            <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
              <div className="flex items-center gap-1.5">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span className="text-emerald-400 font-bold uppercase tracking-wider text-[11px]">Live Score</span>
              </div>
              <Flame className="w-3.5 h-3.5 text-amber-400" />
            </div>
            <div className="mt-1 flex items-baseline justify-between">
              <div className="font-mono text-2xl sm:text-3xl font-extrabold tracking-tight text-emerald-400 drop-shadow-[0_0_12px_rgba(52,211,153,0.45)]">
                {score}
              </div>
              {highScore > 0 && (
                <span className="text-[10px] font-mono text-slate-400">
                  {score >= highScore ? '👑 RECORD' : `-${highScore - score}`}
                </span>
              )}
            </div>
            {/* Live Progress Bar to High Score */}
            {highScore > 0 && (
              <div className="w-full bg-slate-800 h-1.5 rounded-full mt-2 overflow-hidden">
                <div
                  className="bg-gradient-to-r from-emerald-500 to-cyan-400 h-full transition-all duration-200"
                  style={{ width: `${Math.min(100, Math.max(4, (score / highScore) * 100))}%` }}
                />
              </div>
            )}
          </div>

          {/* High Score */}
          <div className="bg-slate-900/90 border border-slate-800/80 rounded-xl p-3 flex flex-col justify-between shadow-lg shadow-black/40">
            <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
              <span>Best</span>
              <Trophy className="w-3.5 h-3.5 text-yellow-400" />
            </div>
            <div className={`mt-1 font-mono text-2xl font-bold tracking-tight ${isNewHighScore ? 'text-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.4)]' : 'text-slate-100'}`}>
              {highScore}
            </div>
            <div className="text-[10px] text-slate-500 mt-1">
              {isNewHighScore ? '⭐ New Record!' : 'All-time Best'}
            </div>
          </div>

          {/* Length / Time */}
          <div className="bg-slate-900/90 border border-slate-800/80 rounded-xl p-3 flex flex-col justify-between shadow-lg shadow-black/40">
            <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
              <span>Time</span>
              <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            </div>
            <div className="mt-1 font-mono text-xl sm:text-2xl font-bold tracking-tight text-cyan-300">
              {formatTime(elapsedSeconds)}
            </div>
            <div className="text-[10px] text-slate-500 mt-1">
              Length: {snakeRef.current.length}
            </div>
          </div>
        </div>

        {/* Game Mode Selector & Quick Controls */}
        <div className="w-full flex items-center justify-between text-xs text-slate-400 px-1">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500">Speed:</span>
            {(['CASUAL', 'NORMAL', 'FAST'] as Difficulty[]).map((spd) => (
              <button
                key={spd}
                disabled={gameState === 'PLAYING'}
                onClick={() => setDifficulty(spd)}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  difficulty === spd
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'bg-slate-900 text-slate-400 border border-transparent hover:text-slate-200 disabled:opacity-50'
                }`}
              >
                {spd.charAt(0) + spd.slice(1).toLowerCase()}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              disabled={gameState === 'PLAYING'}
              onClick={() => setWallMode((m) => (m === 'SOLID' ? 'PASS_THROUGH' : 'SOLID'))}
              className={`px-2 py-0.5 rounded text-[11px] font-medium border transition-colors flex items-center gap-1 ${
                wallMode === 'SOLID'
                  ? 'bg-rose-500/10 text-rose-300 border-rose-500/30'
                  : 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30'
              } disabled:opacity-50`}
            >
              <ShieldAlert className="w-3 h-3" />
              <span>{wallMode === 'SOLID' ? 'Walls: Lethal' : 'Walls: Wrap'}</span>
            </button>
          </div>
        </div>

        {/* Canvas Game Area Container */}
        <div className="relative w-full max-w-[440px] aspect-square rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 shadow-[0_0_40px_rgba(16,185,129,0.12),0_12px_36px_rgba(0,0,0,0.8)]">
          {/* Main 2D Canvas */}
          <canvas
            ref={canvasRef}
            style={{ width: '100%', height: '100%' }}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            className="block touch-none"
          />

          {/* Floating Score Popups */}
          {scorePopups.map((popup) => (
            <div
              key={popup.id}
              style={{
                left: `${(popup.x / CANVAS_DIM) * 100}%`,
                top: `${(popup.y / CANVAS_DIM) * 100}%`,
                color: popup.color,
              }}
              className="absolute pointer-events-none transform -translate-x-1/2 font-mono font-bold text-sm tracking-wider animate-score-pop"
            >
              {popup.text}
            </div>
          ))}

          {/* Top-Right In-Game Pause Button */}
          {gameState === 'PLAYING' && (
            <button
              onClick={togglePause}
              className="absolute top-3 right-3 p-2 rounded-lg bg-slate-900/80 backdrop-blur border border-slate-700/60 text-slate-300 hover:text-white hover:bg-slate-800 transition-colors shadow-md"
              title="Pause (Space)"
            >
              <Pause className="w-4 h-4" />
            </button>
          )}

          {/* Overlay: START SCREEN */}
          {gameState === 'START' && (
            <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center z-20">
              <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mb-4 shadow-[0_0_24px_rgba(16,185,129,0.3)]">
                <Zap className="w-8 h-8 fill-emerald-400/20" />
              </div>

              <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight mb-2">
                Neon Serpent
              </h2>
              <p className="text-sm text-slate-400 max-w-xs mb-6 leading-relaxed">
                Slither through the grid, devour pulsing energy apples, and unlock golden bonuses without striking your own tail.
              </p>

              <button
                onClick={startGame}
                className="px-7 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-bold text-base shadow-[0_0_24px_rgba(16,185,129,0.5)] transition-all hover:scale-105 active:scale-95 flex items-center gap-2 cursor-pointer"
              >
                <Play className="w-5 h-5 fill-slate-950" />
                <span>Start Game</span>
              </button>

              <div className="mt-6 flex items-center gap-3 text-xs text-slate-500">
                <span className="px-2 py-1 bg-slate-900 rounded border border-slate-800 text-slate-400">WASD</span>
                <span>or</span>
                <span className="px-2 py-1 bg-slate-900 rounded border border-slate-800 text-slate-400">Arrow Keys</span>
              </div>
            </div>
          )}

          {/* Overlay: PAUSED */}
          {gameState === 'PAUSED' && (
            <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center z-20">
              <h2 className="text-2xl font-bold text-white tracking-tight mb-2">
                Game Paused
              </h2>
              <p className="text-xs text-slate-400 mb-6">
                Press Spacebar or click Resume to keep going
              </p>

              <div className="flex gap-3">
                <button
                  onClick={togglePause}
                  className="px-5 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm shadow-[0_0_16px_rgba(16,185,129,0.4)] transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <Play className="w-4 h-4 fill-slate-950" />
                  <span>Resume</span>
                </button>
                <button
                  onClick={startGame}
                  className="px-4 py-2.5 rounded-lg bg-slate-900 border border-slate-700 hover:border-slate-600 text-slate-200 text-sm font-medium transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>Restart</span>
                </button>
              </div>
            </div>
          )}

          {/* Overlay: GAME OVER */}
          {gameState === 'GAME_OVER' && (
            <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center z-20">
              {isNewHighScore && (
                <div className="mb-2 px-3 py-1 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs font-bold tracking-wider animate-pulse uppercase">
                  🏆 New High Score!
                </div>
              )}

              <h2 className="text-2xl sm:text-3xl font-extrabold text-rose-500 tracking-tight mb-1">
                Game Over
              </h2>
              <p className="text-xs text-slate-400 mb-4">You crashed into an obstacle</p>

              {/* Stats Summary */}
              <div className="grid grid-cols-2 gap-3 w-full max-w-[260px] bg-slate-900/90 border border-slate-800 rounded-xl p-3 mb-6 text-left">
                <div>
                  <div className="text-[11px] text-slate-500 uppercase">Final Score</div>
                  <div className="font-mono text-xl font-bold text-emerald-400">{score}</div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500 uppercase">Apples Eaten</div>
                  <div className="font-mono text-xl font-bold text-slate-200">{applesEaten + goldenEaten}</div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500 uppercase">Length</div>
                  <div className="font-mono text-sm font-bold text-cyan-400">{snakeRef.current.length} segments</div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500 uppercase">Survived</div>
                  <div className="font-mono text-sm font-bold text-slate-300">{formatTime(elapsedSeconds)}</div>
                </div>
              </div>

              <button
                onClick={startGame}
                className="px-6 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-bold text-sm shadow-[0_0_20px_rgba(16,185,129,0.5)] transition-all hover:scale-105 active:scale-95 flex items-center gap-2 cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Play Again</span>
              </button>
            </div>
          )}
        </div>

        {/* Mobile Touch Virtual D-Pad (Up, Down, Left, Right) */}
        <div className="w-full max-w-[260px] flex flex-col items-center gap-1.5 mt-1 select-none">
          {/* UP Button */}
          <button
            aria-label="Move Up"
            onClick={() => queueDirection('UP')}
            className={`w-14 h-12 rounded-xl flex items-center justify-center transition-all ${
              activeControl === 'UP'
                ? 'bg-emerald-500 text-slate-950 shadow-[0_0_16px_rgba(16,185,129,0.6)] scale-95'
                : 'bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800 active:bg-emerald-500 active:text-slate-950'
            }`}
          >
            <ChevronUp className="w-6 h-6" />
          </button>

          {/* LEFT, DOWN, RIGHT Buttons */}
          <div className="flex items-center gap-2 w-full justify-center">
            <button
              aria-label="Move Left"
              onClick={() => queueDirection('LEFT')}
              className={`w-14 h-12 rounded-xl flex items-center justify-center transition-all ${
                activeControl === 'LEFT'
                  ? 'bg-emerald-500 text-slate-950 shadow-[0_0_16px_rgba(16,185,129,0.6)] scale-95'
                  : 'bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800 active:bg-emerald-500 active:text-slate-950'
              }`}
            >
              <ChevronLeft className="w-6 h-6" />
            </button>

            <button
              aria-label="Move Down"
              onClick={() => queueDirection('DOWN')}
              className={`w-14 h-12 rounded-xl flex items-center justify-center transition-all ${
                activeControl === 'DOWN'
                  ? 'bg-emerald-500 text-slate-950 shadow-[0_0_16px_rgba(16,185,129,0.6)] scale-95'
                  : 'bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800 active:bg-emerald-500 active:text-slate-950'
              }`}
            >
              <ChevronDown className="w-6 h-6" />
            </button>

            <button
              aria-label="Move Right"
              onClick={() => queueDirection('RIGHT')}
              className={`w-14 h-12 rounded-xl flex items-center justify-center transition-all ${
                activeControl === 'RIGHT'
                  ? 'bg-emerald-500 text-slate-950 shadow-[0_0_16px_rgba(16,185,129,0.6)] scale-95'
                : 'bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800 active:bg-emerald-500 active:text-slate-950'
              }`}
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Footer info note */}
        <div className="flex items-center justify-center gap-2 text-xs text-slate-500 text-center">
          <Info className="w-3.5 h-3.5 text-slate-500" />
          <span>Desktop: Arrow Keys / WASD · Space: Pause · Mobile: D-Pad or Swipe</span>
        </div>
      </div>

      {/* Standalone HTML Export Modal */}
      {showExportModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 z-50">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-2xl flex flex-col gap-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Download className="w-5 h-5 text-emerald-400" />
                <h3 className="text-lg font-bold text-white">Standalone Single HTML File</h3>
              </div>
              <button
                onClick={() => setShowExportModal(false)}
                className="text-slate-400 hover:text-white text-sm px-2 py-1 rounded hover:bg-slate-800"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              This standalone single HTML file includes the entire game—HTML structure, modern arcade CSS styling, glowing effects, and responsive JavaScript with Web Audio synthesized sound. You can download and double-click to play anywhere offline!
            </p>

            <div className="relative bg-slate-950 rounded-xl p-3 border border-slate-800 max-h-48 overflow-y-auto font-mono text-[11px] text-slate-400">
              <pre className="whitespace-pre-wrap">{getSingleHtmlSourceCode()}</pre>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={handleCopyCode}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                {copiedCode ? <Check className="w-4 h-4 text-emerald-400" /> : null}
                <span>{copiedCode ? 'Copied to Clipboard!' : 'Copy HTML Code'}</span>
              </button>
              <button
                onClick={handleDownloadHtml}
                className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-xs font-bold text-slate-950 flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm shadow-emerald-500/30"
              >
                <Download className="w-4 h-4" />
                <span>Download .html</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
