import rawData from '../generated/data.json';
import { DEFAULT_CONFIG, type GameData } from '../engine/index.ts';

export const data = rawData as GameData;
export const config = DEFAULT_CONFIG;
export const menuById = new Map(data.menus.map((m) => [m.id, m]));
export const questionById = new Map(data.questions.map((q) => [q.id, q]));
