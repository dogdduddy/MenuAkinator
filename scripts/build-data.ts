// data/*.csv 를 검증하고 src/generated/data.json 으로 변환한다.
// 사용: npm run data  (-- --quiet 로 분석 출력 생략)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeData } from './lib/analysis.ts';
import { loadCsvData } from './lib/load-data.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const quiet = process.argv.includes('--quiet');

const { data, errors, warnings } = loadCsvData(join(root, 'data'));
for (const w of warnings) console.warn(`⚠️  ${w}`);
if (!data) {
  for (const e of errors) console.error(`❌ ${e}`);
  console.error(`\n데이터 오류 ${errors.length}건. JSON을 만들지 않았습니다.`);
  process.exit(1);
}

const out = join(root, 'src/generated/data.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(data));
console.log(`✅ data.json 생성: 메뉴 ${data.menus.length}개, 질문 ${data.questions.length}개, version ${data.version}`);

if (!quiet) {
  const name = new Map(data.menus.map((m) => [m.id, m.name]));
  const a = analyzeData(data);

  console.log(`\n■ 질문 벡터가 완전히 같은 메뉴 쌍: ${a.identicalPairs.length}개 (엔진이 절대 구분할 수 없음)`);
  for (const p of a.identicalPairs) console.log(`  - ${name.get(p.a)} = ${name.get(p.b)}`);

  console.log(`\n■ 구분이 어려운 메뉴 쌍 (크게 갈리는 질문 ≤ 1개): ${a.hardPairs.length}개`);
  for (const p of a.hardPairs) {
    console.log(`  - ${name.get(p.a)} / ${name.get(p.b)}  ${p.strong.length ? `← ${p.strong[0]} 하나로만 갈림` : '← 크게 갈리는 질문 없음'}`);
  }

  console.log(`\n■ 중복 의심 질문 쌍 (|상관계수| ≥ 0.85): ${a.redundantQuestions.length}개`);
  for (const r of a.redundantQuestions) console.log(`  - ${r.a} ~ ${r.b}  r=${r.r.toFixed(2)}`);

  console.log('\n■ 질문별 초기 정보 이득 (균등 사전확률, bits) / 예 메뉴 수 / 유일 구분 쌍');
  for (const q of [...a.questionStats].sort((x, y) => y.initialGainBits - x.initialGainBits)) {
    console.log(`  ${q.initialGainBits.toFixed(3)}  ${String(q.yesCount).padStart(3)}  ${String(q.uniquePairs).padStart(3)}  ${q.id} (${q.group}/${q.scope}) ${q.text}`);
  }
}
