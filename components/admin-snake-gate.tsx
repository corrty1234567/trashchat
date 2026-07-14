"use client";

import clsx from "clsx";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type AdminSnakeGateProps = {
  onClose: () => void;
  onUnlock: () => void;
};

type Cell = {
  x: number;
  y: number;
};

type Direction = "up" | "down" | "left" | "right";

const GRID_SIZE = 16;
const TICK_MS = 135;
const INITIAL_SNAKE: Cell[] = [
  { x: 7, y: 8 },
  { x: 6, y: 8 },
  { x: 5, y: 8 }
];
const INITIAL_DIRECTION: Direction = "right";

function isSameCell(first: Cell, second: Cell) {
  return first.x === second.x && first.y === second.y;
}

function isOppositeDirection(current: Direction, next: Direction) {
  return (
    (current === "up" && next === "down") ||
    (current === "down" && next === "up") ||
    (current === "left" && next === "right") ||
    (current === "right" && next === "left")
  );
}

function getNextHead(head: Cell, direction: Direction) {
  if (direction === "up") {
    return { x: head.x, y: head.y - 1 };
  }

  if (direction === "down") {
    return { x: head.x, y: head.y + 1 };
  }

  if (direction === "left") {
    return { x: head.x - 1, y: head.y };
  }

  return { x: head.x + 1, y: head.y };
}

function getRandomFood(snake: Cell[]) {
  const emptyCells: Cell[] = [];

  for (let y = 0; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      const cell = { x, y };

      if (!snake.some((snakeCell) => isSameCell(snakeCell, cell))) {
        emptyCells.push(cell);
      }
    }
  }

  return emptyCells[Math.floor(Math.random() * emptyCells.length)] ?? { x: 12, y: 8 };
}

async function readApiError(response: Response, fallback: string) {
  const data = (await response.json().catch(() => null)) as { error?: unknown } | null;
  return typeof data?.error === "string" ? data.error : fallback;
}

export function AdminSnakeGate({ onClose, onUnlock }: AdminSnakeGateProps) {
  const [snake, setSnake] = useState<Cell[]>(INITIAL_SNAKE);
  const [food, setFood] = useState<Cell>(() => getRandomFood(INITIAL_SNAKE));
  const [score, setScore] = useState(0);
  const [isGameOver, setIsGameOver] = useState(false);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [password, setPassword] = useState("");
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const directionRef = useRef<Direction>(INITIAL_DIRECTION);
  const touchStartRef = useRef<Cell | null>(null);

  const occupiedCells = useMemo(() => new Set(snake.map((cell) => `${cell.x}-${cell.y}`)), [snake]);

  const chooseDirection = useCallback((nextDirection: Direction) => {
    if (isOppositeDirection(directionRef.current, nextDirection)) {
      return;
    }

    directionRef.current = nextDirection;
  }, []);

  const resetGame = useCallback(() => {
    directionRef.current = INITIAL_DIRECTION;
    setSnake(INITIAL_SNAKE);
    setFood(getRandomFood(INITIAL_SNAKE));
    setScore(0);
    setIsGameOver(false);
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;

      if (isPasswordVisible || target?.closest("input, textarea, select") || target?.isContentEditable) {
        return;
      }

      if (event.key === "ArrowUp" || event.key.toLowerCase() === "w") {
        event.preventDefault();
        chooseDirection("up");
      } else if (event.key === "ArrowDown" || event.key.toLowerCase() === "s") {
        event.preventDefault();
        chooseDirection("down");
      } else if (event.key === "ArrowLeft" || event.key.toLowerCase() === "a") {
        event.preventDefault();
        chooseDirection("left");
      } else if (event.key === "ArrowRight" || event.key.toLowerCase() === "d") {
        event.preventDefault();
        chooseDirection("right");
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [chooseDirection, isPasswordVisible]);

  useEffect(() => {
    if (isGameOver || isPasswordVisible) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setSnake((currentSnake) => {
        const nextHead = getNextHead(currentSnake[0], directionRef.current);
        const isOutside =
          nextHead.x < 0 || nextHead.x >= GRID_SIZE || nextHead.y < 0 || nextHead.y >= GRID_SIZE;

        if (isOutside || currentSnake.some((cell) => isSameCell(cell, nextHead))) {
          setIsGameOver(true);
          return currentSnake;
        }

        const hasEaten = isSameCell(nextHead, food);
        const nextSnake = [nextHead, ...currentSnake];

        if (hasEaten) {
          setScore((currentScore) => currentScore + 1);
          setFood(getRandomFood(nextSnake));
        } else {
          nextSnake.pop();
        }

        return nextSnake;
      });
    }, TICK_MS);

    return () => window.clearInterval(intervalId);
  }, [food, isGameOver, isPasswordVisible]);

  function handlePointerUp(clientX: number, clientY: number) {
    const start = touchStartRef.current;
    touchStartRef.current = null;

    if (!start) {
      return;
    }

    const deltaX = clientX - start.x;
    const deltaY = clientY - start.y;

    if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < 18) {
      return;
    }

    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      chooseDirection(deltaX > 0 ? "right" : "left");
    } else {
      chooseDirection(deltaY > 0 ? "down" : "up");
    }
  }

  async function unlockAdmin() {
    if (!password.trim() || isUnlocking) {
      return;
    }

    setIsUnlocking(true);
    setUnlockError(null);

    try {
      const response = await fetch("/api/admin/session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        credentials: "same-origin",
        body: JSON.stringify({ code: password.trim() })
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "密碼錯誤"));
      }

      setPassword("");
      onUnlock();
    } catch (error) {
      setUnlockError(error instanceof Error ? error.message : "密碼錯誤");
    } finally {
      setIsUnlocking(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[1050] flex items-center justify-center bg-slate-950/35 px-4 py-6 backdrop-blur-sm">
      <section className="relative w-full max-w-sm overflow-hidden rounded-lg border border-white/70 bg-white shadow-[0_24px_90px_rgba(15,23,42,0.28)]">
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ink">trashchat</h2>
            <p className="text-xs text-slate-500">Score {score}</p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={resetGame}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
              aria-label="重新開始"
            >
              <RotateCcw size={16} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
              aria-label="關閉"
            >
              <X size={17} />
            </button>
          </div>
        </header>

        <div className="p-4">
          <div
            className="relative mx-auto grid aspect-square w-full max-w-[320px] touch-none rounded-md border border-line bg-slate-950 p-1"
            style={{
              gridTemplateColumns: `repeat(${GRID_SIZE}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${GRID_SIZE}, minmax(0, 1fr))`
            }}
            onPointerDown={(event) => {
              touchStartRef.current = { x: event.clientX, y: event.clientY };
            }}
            onPointerUp={(event) => handlePointerUp(event.clientX, event.clientY)}
          >
            {Array.from({ length: GRID_SIZE * GRID_SIZE }).map((_, index) => {
              const x = index % GRID_SIZE;
              const y = Math.floor(index / GRID_SIZE);
              const isHead = snake[0]?.x === x && snake[0]?.y === y;
              const isSnake = occupiedCells.has(`${x}-${y}`);
              const isFood = food.x === x && food.y === y;

              return (
                <span
                  key={`${x}-${y}`}
                  className={clsx(
                    "m-[1px] rounded-[2px]",
                    isHead && "bg-emerald-300",
                    !isHead && isSnake && "bg-emerald-500",
                    isFood && "bg-rose-400",
                    !isSnake && !isFood && "bg-slate-900"
                  )}
                />
              );
            })}

            {isGameOver ? (
              <button
                type="button"
                onClick={resetGame}
                className="absolute inset-0 flex items-center justify-center bg-slate-950/70 text-sm font-semibold text-white"
              >
                Game over
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => setIsPasswordVisible(true)}
              className="absolute bottom-1 right-1 h-4 w-4 rounded-sm opacity-0"
              tabIndex={-1}
              aria-label="."
            />
          </div>

          <div className="mx-auto mt-3 grid w-32 grid-cols-3 gap-1">
            <span />
            <button
              type="button"
              onClick={() => chooseDirection("up")}
              className="inline-flex h-10 items-center justify-center rounded-md border border-line text-slate-700"
              aria-label="上"
            >
              <ChevronUp size={18} />
            </button>
            <span />
            <button
              type="button"
              onClick={() => chooseDirection("left")}
              className="inline-flex h-10 items-center justify-center rounded-md border border-line text-slate-700"
              aria-label="左"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              type="button"
              onClick={() => chooseDirection("down")}
              className="inline-flex h-10 items-center justify-center rounded-md border border-line text-slate-700"
              aria-label="下"
            >
              <ChevronDown size={18} />
            </button>
            <button
              type="button"
              onClick={() => chooseDirection("right")}
              className="inline-flex h-10 items-center justify-center rounded-md border border-line text-slate-700"
              aria-label="右"
            >
              <ChevronRight size={18} />
            </button>
          </div>

          {isPasswordVisible ? (
            <form
              className="mt-4 space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                void unlockAdmin();
              }}
            >
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                autoFocus
                className="h-10 w-full rounded-md border border-line bg-slate-50 px-3 text-sm outline-none transition focus:border-brand focus:bg-white focus:ring-4 focus:ring-brand/10"
              />
              {unlockError ? <p className="text-xs text-red-600">{unlockError}</p> : null}
              <button
                type="submit"
                disabled={isUnlocking}
                className="h-10 w-full rounded-md bg-brand text-sm font-semibold text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                進入
              </button>
            </form>
          ) : null}
        </div>
      </section>
    </div>
  );
}
