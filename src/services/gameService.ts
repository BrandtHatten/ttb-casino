import { SymbolType, GameSymbol, SYMBOLS, GRID_ROWS, GRID_COLS } from '../types';

const SYMBOL_WEIGHTS: Record<string, number> = {
  BANANA: 20,
  GRAPE: 18,
  WATERMELON: 16,
  PLUM: 14,
  APPLE: 12,
  RECTANGLE: 10,
  PENTAGON: 8,
  SQUARE: 6,
  HEART: 4
};

const NORMAL_TYPES = Object.keys(SYMBOL_WEIGHTS) as SymbolType[];
const TOTAL_NORMAL_WEIGHT = Object.values(SYMBOL_WEIGHTS).reduce((a, b) => a + b, 0);

const MULTIPLIER_VALUES = [2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 50, 100, 1000];
const MULTIPLIER_WEIGHTS = [20, 15, 12, 10, 8, 7, 6, 5, 4, 3, 2, 1, 0.5, 0.1];
const TOTAL_MULTIPLIER_WEIGHT = MULTIPLIER_WEIGHTS.reduce((a, b) => a + b, 0);

let symbolIdCounter = 0;

export const generateId = () => `sym-${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${symbolIdCounter++}`;

export const generateSymbol = (type?: SymbolType, isFreeSpinMode: boolean = false): GameSymbol => {
  let selectedType = type;
  if (!selectedType) {
    const rand = Math.random();
    if (rand < 0.025) {
      selectedType = 'SCATTER';
    } 
    else if (isFreeSpinMode && rand < 0.06) {
      selectedType = 'MULTIPLIER';
    } 
    else {
      let normalRand = Math.random() * TOTAL_NORMAL_WEIGHT;
      
      for (const t of NORMAL_TYPES) {
        if (normalRand < SYMBOL_WEIGHTS[t]) {
          selectedType = t;
          break;
        }
        normalRand -= SYMBOL_WEIGHTS[t];
      }
      if (!selectedType) selectedType = 'BANANA';
    }
  }

  const symbol: GameSymbol = {
    id: generateId(),
    ...SYMBOLS[selectedType],
    isNew: true,
  };

  if (selectedType === 'MULTIPLIER') {
    let random = Math.random() * TOTAL_MULTIPLIER_WEIGHT;
    let selectedIdx = 0;
    for (let i = 0; i < MULTIPLIER_WEIGHTS.length; i++) {
      if (random < MULTIPLIER_WEIGHTS[i]) {
        selectedIdx = i;
        break;
      }
      random -= MULTIPLIER_WEIGHTS[i];
    }
    symbol.multiplier = MULTIPLIER_VALUES[selectedIdx];
  }

  return symbol;
};

export const generateInitialGrid = (isFreeSpinMode: boolean = false, guaranteedScatters: number = 0) => {
  const grid: GameSymbol[][] = [];
  for (let r = 0; r < GRID_ROWS; r++) {
    const row: GameSymbol[] = [];
    for (let c = 0; c < GRID_COLS; c++) {
      row.push(generateSymbol(undefined, isFreeSpinMode));
    }
    grid.push(row);
  }

  if (guaranteedScatters > 0) {
    const positions: {r: number, c: number}[] = [];
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        positions.push({r, c});
      }
    }
    for (let i = positions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [positions[i], positions[j]] = [positions[j], positions[i]];
    }
    for (let i = 0; i < Math.min(guaranteedScatters, positions.length); i++) {
      const {r, c} = positions[i];
      grid[r][c] = generateSymbol('SCATTER', isFreeSpinMode);
    }
  }

  return grid;
};
