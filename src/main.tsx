// UI 프레임워크: Preact. gzip 약 4KB이고 React와 같은 hooks/JSX를 쓴다.
// 화면이 몇 개뿐이지만 되돌리기·검색 같은 상태가 있어 vanilla DOM 조작보다 짧고 읽기 쉽다.
// 엔진(src/engine)은 Preact에 의존하지 않는다.
import { render } from 'preact';
import { App } from './ui/App.tsx';
import './ui/styles.css';

render(<App />, document.getElementById('app')!);
