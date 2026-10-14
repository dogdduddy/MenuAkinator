// 엔진·데이터 실험. 시뮬레이터(simulate.ts)는 현재 설정의 정기 리포트, 이 스크립트는 비교 실험용.
// 사용: npm run experiments -- [--only E1,E2,E3] [--n 10] [--seed 1]
//
// E1. 데이터 버전 비교 — 가상 사용자 표를 고정하고 엔진 데이터만 바꾼다
// E2. 고정 예산 평가 — 추측 없이 5·10·15문항을 물은 뒤 1위/3위 안에 정답이 있는지 (추측 임계값과 무관한 추론 성능)
// E3. α / 실수율 × 추측 임계값 — 실제 게임 규칙에서의 성공률·질문 수·과신
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_CONFIG, answer as applyAnswer, clampP, computePosterior, indexOf, newGame, nextAction, ranked,
  type Answer, type EngineConfig, type GameData,
} from '../src/engine/index.ts';
import { loadCsvData } from './lib/load-data.ts';
import { calibrationError, num, pct, summarize, type Summary } from './lib/metrics.ts';
import {
  BASIC_STYLE, loadUserMatrix, makeRng, perturbMatrix, playGame, type Rng, type UserStyle,
} from './lib/sim.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (name: string, def: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const onlyArg = args.indexOf('--only') >= 0 ? args[args.indexOf('--only') + 1].split(',') : null;
const want = (k: string) => !onlyArg || onlyArg.includes(k);
const N = arg('n', 10);
const SEED = arg('seed', 1);
const started = Date.now();

const line = (s = '') => console.log(s);
const hr = () => line('─'.repeat(100));

function load(dir: string): GameData {
  const { data, errors } = loadCsvData(join(root, dir));
  if (!data) throw new Error(`${dir}: ${errors.join('; ')}`);
  return data;
}
const versions: Record<string, GameData> = {
  v1: load('data/versions/v1'),
  v2: load('data/versions/v2'),
  v3: load('data/versions/v3'),
};
const current = load('data');

/** 여러 버전의 질문을 모두 포함하는 평가용 사용자 표. 같은 질문은 앞의 버전 값을 쓴다 */
function mergeTables(primary: GameData, ...rest: GameData[]): GameData {
  const questions = [...primary.questions];
  const seen = new Set(questions.map((q) => q.id));
  const sources = questions.map(() => primary);
  for (const d of rest) {
    for (const q of d.questions) {
      if (seen.has(q.id)) continue;
      seen.add(q.id);
      questions.push(q);
      sources.push(d);
    }
  }
  const matrix = primary.menus.map((m) => questions.map((q, qi) => {
    const d = sources[qi];
    const mi = d.menus.findIndex((x) => x.id === m.id);
    return d.matrix[mi][d.questions.findIndex((x) => x.id === q.id)];
  }));
  return { ...primary, version: 'eval', questions, matrix };
}

/** 사용자가 덜 일관되게 답하는 표: 0.98/0.02 칸을 0.9/0.1로 */
const soften = (d: GameData): GameData => ({
  ...d,
  matrix: d.matrix.map((r) => r.map((v) => (v >= 0.95 ? 0.9 : v <= 0.05 ? 0.1 : v))),
});

const evalStrict = mergeTables(versions.v3, versions.v2, versions.v1);
const evalSoft = soften(evalStrict);
const USERS = [
  { key: 'U1', label: 'U1 표(v3)대로 답함 + 실수 5%', table: evalStrict },
  { key: 'U2', label: 'U2 당연한 질문도 10%는 반대로 + 실수 5%', table: evalSoft },
];

function runAll(engine: GameData, cfg: EngineConfig, userTable: GameData, n: number, rng: Rng, style: UserStyle = BASIC_STYLE, perturb = 0) {
  let um = loadUserMatrix(userTable, engine);
  if (perturb > 0) um = perturbMatrix(um, perturb, rng);
  const games = [];
  for (let mi = 0; mi < engine.menus.length; mi++) {
    for (let k = 0; k < n; k++) games.push(playGame(engine, cfg, 'lunch', um[mi], engine.menus[mi].id, style, rng));
  }
  return games;
}

const report: Record<string, unknown> = { createdAt: new Date().toISOString(), N, SEED, currentData: current.version };
const cfg0: EngineConfig = { ...DEFAULT_CONFIG, useTimePrior: false };

line();
line(`실험 · 판수 ${N}/메뉴 · seed ${SEED} · 버전 v1 ${versions.v1.version} / v2 ${versions.v2.version} / v3 ${versions.v3.version} (현재 data/ = ${current.version})`);
line('⚠️  모두 가상 사용자 실험입니다. 실제 사람의 정확도를 뜻하지 않습니다.');
hr();

// ───────── E1 ─────────
if (want('E1')) {
  line('E1. 데이터 버전 비교 — 가상 사용자 표 고정, 엔진 데이터만 교체 (기본 설정: α 1, 실수율 0, 임계값 0.7)');
  line('    평가용 사용자 표 = v3 값 + v3에 없는 질문(v1에서 삭제된 4개)은 v1 값');
  line('사용자 / 엔진        첫추측(게임) 첫추측(추측) 추측성공  후보안  평균Q  고확신오답(추측)  보정오차');
  const rows: unknown[] = [];
  const perMenu: Record<string, Record<string, number>> = {};
  for (const u of USERS) {
    for (const [vk, engine] of Object.entries(versions)) {
      const games = runAll(engine, cfg0, u.table, N, makeRng(SEED));
      const s = summarize(games);
      rows.push({ user: u.key, engine: vk, summary: s });
      line(`${u.key} / ${vk}             ${pct(s.firstGuessAccPerGame)}     ${pct(s.firstGuessAccPerGuessed)}   ${pct(s.solvedByGuessPerGame)} ${pct(s.inCandidatesPerGame)}  ${num(s.avgQuestionsAll).padStart(5)}    ${pct(s.highConfWrongPerHighConfGuess)}        ${num(calibrationError(s.calibration), 3)}`);
      if (u.key === 'U1') {
        for (const m of engine.menus) {
          perMenu[m.id] ??= {};
          perMenu[m.id][vk] = summarize(games.filter((g) => g.target === m.id)).solvedByGuessPerGame;
        }
      }
    }
  }
  for (const u of USERS) line(`  ${u.key} = ${u.label}`);
  const name = new Map(current.menus.map((m) => [m.id, m.name]));
  const deltas = Object.entries(perMenu).map(([id, v]) => ({ id, d: v.v3 - v.v1, v1: v.v1, v3: v.v3 })).sort((a, b) => a.d - b.d);
  line('  U1 기준 v1→v3에서 추측성공이 가장 떨어진 메뉴 (삭제한 질문의 영향 확인용):');
  line('   ' + deltas.slice(0, 8).map((x) => `${name.get(x.id)} ${pct(x.v1).trim()}→${pct(x.v3).trim()}`).join(' · '));
  line('  v1에서 삭제한 질문(fastfood·cream·cheese·delivery)에 기대던 메뉴: ' +
    ['burger', 'cream_pasta', 'tomato_pasta', 'pizza'].map((id) => `${name.get(id)} ${pct(perMenu[id].v1).trim()}→${pct(perMenu[id].v3).trim()}`).join(' · '));
  report.E1 = { rows, perMenuDeltas: deltas };
  hr();
}

// ───────── E2 ─────────
type Budget = { at: number; top1: number; top3: number };
function playFixedBudget(engine: GameData, cfg: EngineConfig, userRow: number[], target: string, style: UserStyle, rng: Rng, checkpoints: number[]): Budget[] {
  const qIdx = indexOf(engine).question;
  const noGuess = { ...cfg, guessThreshold: 2, maxQuestions: Math.max(...checkpoints) };
  let state = newGame('lunch');
  const out: Budget[] = [];
  for (let step = 0; step <= noGuess.maxQuestions; step++) {
    const post = computePosterior(engine, noGuess, state);
    if (checkpoints.includes(post.questionCount)) {
      const top = ranked(engine, post, 3).map((r) => r.menuId);
      out.push({ at: post.questionCount, top1: top[0] === target ? 1 : 0, top3: top.includes(target) ? 1 : 0 });
    }
    const act = nextAction(engine, noGuess, state, post);
    if (act.type !== 'ask') break;
    const qi = qIdx.get(act.questionId)!;
    let yes = rng() < clampP(userRow[qi]);
    if (rng() < style.noise) yes = !yes;
    state = applyAnswer(state, act.questionId, (yes ? 'yes' : 'no') as Answer);
  }
  return out;
}

const VARIANTS: { key: string; cfg: Partial<EngineConfig> }[] = [
  { key: 'α1 (현재)', cfg: { evidenceWeight: 1, slipRate: 0 } },
  { key: 'α0.7', cfg: { evidenceWeight: 0.7, slipRate: 0 } },
  { key: 'α0.5', cfg: { evidenceWeight: 0.5, slipRate: 0 } },
  { key: '실수율0.05', cfg: { evidenceWeight: 1, slipRate: 0.05 } },
  { key: '실수율0.1', cfg: { evidenceWeight: 1, slipRate: 0.1 } },
];
const E_USERS = [
  { key: 'U1', table: evalStrict, perturb: 0 },
  { key: 'U1+인식차20%', table: evalStrict, perturb: 0.2 },
  { key: 'U2', table: evalSoft, perturb: 0 },
];

if (want('E2')) {
  line('E2. 고정 예산 평가 — 추측 없이 질문만 한 뒤 1위·3위 안 정답 비율 (임계값과 무관한 추론 성능, 엔진 v3)');
  line('    α·실수율은 질문 선택에도 영향을 주므로 "같은 답변 기록 재계산"이 아니라 실제 진행으로 비교');
  const cps = [5, 10, 15];
  line(`사용자          설정          ${cps.map((c) => `Top1@${c}  Top3@${c}`).join('   ')}`);
  const rows: unknown[] = [];
  for (const u of E_USERS) {
    for (const v of VARIANTS) {
      const rng = makeRng(SEED + 7);
      const cfg = { ...cfg0, ...v.cfg };
      let um = loadUserMatrix(u.table, versions.v3);
      if (u.perturb) um = perturbMatrix(um, u.perturb, makeRng(SEED + 99));
      const acc = new Map<number, { t1: number; t3: number; n: number }>();
      versions.v3.menus.forEach((m, mi) => {
        for (let k = 0; k < N; k++) {
          for (const b of playFixedBudget(versions.v3, cfg, um[mi], m.id, BASIC_STYLE, rng, cps)) {
            const a = acc.get(b.at) ?? { t1: 0, t3: 0, n: 0 };
            a.t1 += b.top1; a.t3 += b.top3; a.n++;
            acc.set(b.at, a);
          }
        }
      });
      const cells = cps.map((c) => {
        const a = acc.get(c)!;
        return `${pct(a.t1 / a.n)} ${pct(a.t3 / a.n)}`;
      });
      rows.push({ user: u.key, variant: v.key, budget: Object.fromEntries([...acc].map(([k, a]) => [k, { top1: a.t1 / a.n, top3: a.t3 / a.n }])) });
      line(`${u.key.padEnd(14)} ${v.key.padEnd(12)} ${cells.join('   ')}`);
    }
  }
  report.E2 = rows;
  hr();
}

// ───────── E3 ─────────
if (want('E3')) {
  line('E3. α / 실수율 × 추측 임계값 — 실제 게임 규칙 (엔진 v3, 최소 3·최대 15문항)');
  const thresholds = [0.5, 0.6, 0.7, 0.8, 0.9];
  const rows: { user: string; variant: string; threshold: number; s: Summary }[] = [];
  for (const u of E_USERS) {
    line(`[${u.key}]  설정 \\ 임계값 → 첫추측(게임) / 추측성공 / 평균Q / 게임당 추측 / 고확신오답(추측) / 보정오차`);
    for (const v of VARIANTS) {
      const parts: string[] = [];
      for (const t of thresholds) {
        const cfg = { ...cfg0, ...v.cfg, guessThreshold: t };
        const rng = makeRng(SEED + 11);
        const s = summarize(runAll(versions.v3, cfg, u.table, N, rng, BASIC_STYLE, u.perturb));
        rows.push({ user: u.key, variant: v.key, threshold: t, s });
        parts.push(`${t}: ${pct(s.firstGuessAccPerGame).trim()}/${pct(s.solvedByGuessPerGame).trim()}/${num(s.avgQuestionsAll)}/${num(s.guessesPerGame, 2)}/${pct(s.highConfWrongPerHighConfGuess).trim()}/${num(calibrationError(s.calibration), 2)}`);
      }
      line(`  ${v.key.padEnd(12)} ${parts.slice(0, 3).join('  ')}`);
      line(`  ${''.padEnd(12)} ${parts.slice(3).join('  ')}`);
    }
    hr();
  }
  report.E3 = rows.map((r) => ({ user: r.user, variant: r.variant, threshold: r.threshold, summary: r.s }));
}

const dir = join(root, 'reports');
mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
writeFileSync(join(dir, `experiments-${stamp}.json`), JSON.stringify(report, null, 2));
line(`저장: reports/experiments-${stamp}.json  (${((Date.now() - started) / 1000).toFixed(1)}초)`);
