import preact from '@preact/preset-vite';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const root = dirname(fileURLToPath(import.meta.url));
const RESULTS_FILE = join(root, 'results', 'results.jsonl');
const MAX_BODY = 200_000;

/**
 * 개발 서버 전용: POST /__results 로 받은 게임 시작·결과 기록을 results/results.jsonl 에 한 줄씩 추가한다.
 * `vite build` 결과물에는 포함되지 않으므로 배포본은 여전히 완전한 정적 사이트다.
 */
function resultsFilePlugin(): Plugin {
  return {
    name: 'menu-akinator-results-file',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__results', (req, res) => {
        if (req.method === 'GET') {
          const lines = existsSync(RESULTS_FILE) ? readFileSync(RESULTS_FILE, 'utf8').split('\n').filter(Boolean) : [];
          const count = lines.filter((l) => !l.includes('"kind":"start"')).length;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ file: 'results/results.jsonl', count }));
          return;
        }
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
          if (body.length > MAX_BODY) req.destroy();
        });
        req.on('end', () => {
          try {
            const result = JSON.parse(body);
            if (result?.schema !== 1) throw new Error('schema');
            mkdirSync(dirname(RESULTS_FILE), { recursive: true });
            appendFileSync(RESULTS_FILE, JSON.stringify(result) + '\n');
            server.config.logger.info(result.kind === 'start'
              ? `[results] 시작 #${result.playIndex} (${result.mode === 'assigned' ? '지정 메뉴' : '자유'})`
              : `[results] 결과 #${result.playIndex} ${result.solved ? '맞힘' : '못 맞힘'} → ${result.finalMenuId ?? result.notInListName ?? '목록에 없음'}`);
            res.statusCode = 204;
          } catch {
            res.statusCode = 400;
          }
          res.end();
        });
      });
    },
  };
}

export default defineConfig({
  // 상대 경로로 빌드해서 GitHub Pages(하위 경로)와 Cloudflare Pages(루트) 모두에서 동작하게 한다.
  base: './',
  plugins: [preact(), resultsFilePlugin()],
});
