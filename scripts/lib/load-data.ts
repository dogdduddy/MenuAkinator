import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { clampP } from '../../src/engine/likelihood.ts';
import { TIME_SLOTS, type GameData, type Menu, type Question } from '../../src/engine/types.ts';

export const TIME_WEIGHT_MIN = 0.5;
export const TIME_WEIGHT_MAX = 2;

/** 따옴표를 지원하는 최소 CSV 파서. 빈 줄은 건너뛴다. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else cell += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((v) => v.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((v) => v.trim() !== '')) rows.push(row);
  return rows.map((r) => r.map((v) => v.trim()));
}

function toObjects(rows: string[][]): Record<string, string>[] {
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

export interface LoadResult {
  data: GameData | null;
  errors: string[];
  warnings: string[];
}

export function loadCsvData(dir: string): LoadResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const raw = ['menus.csv', 'questions.csv', 'matrix.csv'].map((f) => readFileSync(join(dir, f), 'utf8'));
  const version = createHash('sha256').update(raw.join('\0')).digest('hex').slice(0, 8);
  const [menuRows, questionRows, matrixRows] = raw.map(parseCsv);

  // 질문
  const questions: Question[] = [];
  const qSeen = new Set<string>();
  for (const [i, r] of toObjects(questionRows).entries()) {
    const where = `questions.csv ${i + 2}행`;
    if (!r.id) { errors.push(`${where}: id 없음`); continue; }
    if (qSeen.has(r.id)) errors.push(`${where}: 중복 id ${r.id}`);
    qSeen.add(r.id);
    if (!r.text) errors.push(`${where}: text 없음`);
    if (!r.group) errors.push(`${where}: group 없음`);
    if (r.scope !== 'broad' && r.scope !== 'fine') errors.push(`${where}: scope는 broad|fine (${r.scope})`);
    questions.push({ id: r.id, text: r.text, group: r.group, scope: r.scope as Question['scope'] });
  }

  // 메뉴
  const menus: Menu[] = [];
  const mSeen = new Set<string>();
  for (const [i, r] of toObjects(menuRows).entries()) {
    const where = `menus.csv ${i + 2}행`;
    if (!r.id) { errors.push(`${where}: id 없음`); continue; }
    if (mSeen.has(r.id)) errors.push(`${where}: 중복 id ${r.id}`);
    mSeen.add(r.id);
    if (!r.name) errors.push(`${where}: name 없음`);
    const timeWeights = {} as Menu['timeWeights'];
    for (const slot of TIME_SLOTS) {
      const v = Number(r[slot]);
      if (r[slot] === '' || !Number.isFinite(v)) errors.push(`${where}: ${slot} 값이 숫자가 아님 (${r[slot]})`);
      else if (v < TIME_WEIGHT_MIN || v > TIME_WEIGHT_MAX) {
        errors.push(`${where}: ${slot}=${v} — 시간대 가중치는 ${TIME_WEIGHT_MIN}~${TIME_WEIGHT_MAX} 범위여야 함`);
      }
      timeWeights[slot] = v;
    }
    menus.push({
      id: r.id,
      name: r.name,
      aliases: r.aliases ? r.aliases.split('|').map((s) => s.trim()).filter(Boolean) : [],
      category: r.category,
      timeWeights,
    });
  }

  // 확률표
  const [mHeader, ...mBody] = matrixRows;
  const colOf = new Map(mHeader.map((h, i) => [h, i]));
  if (mHeader[0] !== 'menu_id') errors.push('matrix.csv: 첫 열은 menu_id 여야 함');
  for (const q of questions) if (!colOf.has(q.id)) errors.push(`matrix.csv: 질문 열 없음 ${q.id}`);
  for (const h of mHeader.slice(1)) {
    if (h !== 'name' && !qSeen.has(h)) errors.push(`matrix.csv: questions.csv에 없는 열 ${h}`);
  }
  const rowOf = new Map<string, string[]>();
  for (const r of mBody) {
    if (rowOf.has(r[0])) errors.push(`matrix.csv: 중복 행 ${r[0]}`);
    rowOf.set(r[0], r);
    if (!mSeen.has(r[0])) errors.push(`matrix.csv: menus.csv에 없는 메뉴 ${r[0]}`);
  }
  const matrix: number[][] = [];
  for (const m of menus) {
    const r = rowOf.get(m.id);
    if (!r) { errors.push(`matrix.csv: 메뉴 행 없음 ${m.id}`); matrix.push(questions.map(() => 0.5)); continue; }
    matrix.push(questions.map((q) => {
      const cell = r[colOf.get(q.id) ?? -1];
      const v = Number(cell);
      if (cell === undefined || cell === '' || !Number.isFinite(v)) {
        errors.push(`matrix.csv: ${m.id} × ${q.id} 빈 칸 또는 숫자 아님 (${cell})`);
        return 0.5;
      }
      if (v < 0 || v > 1) errors.push(`matrix.csv: ${m.id} × ${q.id} = ${v} (0~1 범위 밖)`);
      return clampP(v);
    }));
  }

  return { data: errors.length ? null : { version, menus, questions, matrix }, errors, warnings };
}
