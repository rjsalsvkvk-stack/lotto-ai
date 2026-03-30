#!/usr/bin/env node
/**
 * scripts/fetch_latest.js
 * ─────────────────────────────────────────────────────────────
 * GitHub Actions에서 실행되는 로또 최신 회차 수집 스크립트
 *
 * 동작:
 *   1. lotto_collector.js 에서 현재 BUILT_IN_MAX 읽기
 *   2. 동행복권 공식 API에서 신규 회차 데이터 가져오기
 *      (Node.js 서버 환경 → CORS 없음, 직접 호출 가능)
 *   3. 신규 데이터 있으면 lotto_collector.js BUILT_IN_DB에 추가
 *   4. .latest_round 파일에 최신 회차 번호 저장 (커밋 메시지용)
 * ─────────────────────────────────────────────────────────────
 */

import fetch  from 'node-fetch';
import fs     from 'fs';
import path   from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const COLLECTOR = path.join(ROOT, 'lotto_collector.js');

// ──────────────────────────────────────────────────────────────
//  동행복권 공식 API 호출 (서버측 → CORS 없음)
// ──────────────────────────────────────────────────────────────
async function fetchRound(round) {
  const url = `https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo=${round}`;
  try {
    const res  = await fetch(url, { timeout: 10000 });
    const json = await res.json();
    if (json.returnValue !== 'success') return null;
    return {
      n: [json.drwtNo1, json.drwtNo2, json.drwtNo3,
          json.drwtNo4, json.drwtNo5, json.drwtNo6].sort((a, b) => a - b),
      b: json.bnusNo,
      d: json.drwNoDate ? json.drwNoDate.replace(/-/g, '.') : ''
    };
  } catch (e) {
    console.warn(`  ⚠️  ${round}회 수집 실패:`, e.message);
    return null;
  }
}

// ──────────────────────────────────────────────────────────────
//  lotto_collector.js 에서 현재 BUILT_IN_MAX 추출
// ──────────────────────────────────────────────────────────────
function getCurrentMax(src) {
  // 내장 DB의 마지막 회차 번호 추출
  // 패턴: "1217:{n:[...],b:NN" 또는 "1217:{n:[...],b:NN,d:'...'}"
  const matches = [...src.matchAll(/^\s{4}(\d{3,4}):\{n:\[/gm)];
  if (!matches.length) throw new Error('BUILT_IN_DB 회차 파싱 실패');
  const rounds = matches.map(m => parseInt(m[1], 10));
  return Math.max(...rounds);
}

// ──────────────────────────────────────────────────────────────
//  날짜 기반 예상 최신 회차 계산
// ──────────────────────────────────────────────────────────────
function estimateLatest() {
  const FIRST = new Date(2002, 11, 7); // 2002-12-07 1회
  const now   = new Date();
  return Math.floor((now - FIRST) / (7 * 24 * 60 * 60 * 1000)) + 1;
}

// ──────────────────────────────────────────────────────────────
//  실제 최신 회차 탐색 (예상 ± 여유분)
// ──────────────────────────────────────────────────────────────
async function findTrueLatest(estimated) {
  // 위로 최대 5회 탐색
  let latest = null;
  for (let r = estimated + 5; r >= estimated - 5; r--) {
    const data = await fetchRound(r);
    if (data) {
      console.log(`  ✅ 최신 회차 확인: ${r}회 (${data.d})`);
      latest = { round: r, data };
      break;
    }
  }
  return latest;
}

// ──────────────────────────────────────────────────────────────
//  lotto_collector.js BUILT_IN_DB 마지막 항목 뒤에 새 회차 삽입
//  패턴: 마지막 "NNNN:{n:[...],b:NN,d:'...'}" 바로 뒤 "\n  };"
// ──────────────────────────────────────────────────────────────
function insertRounds(src, newRounds) {
  if (!newRounds.length) return src;

  // 마지막 DB 항목 + 닫는 패턴 찾기
  // "    1217:{n:[...],b:41,d:'2026.03.28'}\n  };"
  const closingPattern = /(\s{4}\d{3,4}:\{n:\[[^\]]+\],b:\d+(?:,d:'[^']*')?\})\s*\n(\s*\};)/;
  const match = src.match(closingPattern);
  if (!match) throw new Error('BUILT_IN_DB 닫는 위치를 찾을 수 없음');

  const insertAt = src.indexOf(match[0]);
  const before   = src.slice(0, insertAt + match[1].length); // 마지막 항목까지
  const after    = src.slice(insertAt + match[1].length);    // "\n  };" 부터

  const date    = new Date().toISOString().slice(0, 10);
  const comment = `\n    // ── 자동 업데이트 (${date}) ──`;
  const lines   = newRounds.map(({ round, data }) => {
    const nums = JSON.stringify(data.n);
    return `    ${round}:{n:${nums},b:${data.b},d:'${data.d}'}`;
  });

  return before + ',' + comment + '\n' + lines.join(',\n') + after;
}

// ──────────────────────────────────────────────────────────────
//  메인
// ──────────────────────────────────────────────────────────────
async function main() {
  console.log('🎲 로또 최신 회차 업데이트 시작\n');

  // 강제 회차 (workflow_dispatch 입력값)
  const forceRound = process.env.FORCE_ROUND ? parseInt(process.env.FORCE_ROUND, 10) : null;

  // 현재 소스 읽기
  const src = fs.readFileSync(COLLECTOR, 'utf8');

  // 현재 내장 DB 최대 회차
  const currentMax = getCurrentMax(src);
  console.log(`📦 현재 내장 DB 최대 회차: ${currentMax}회`);

  // 예상 최신 회차
  const estimated = forceRound || estimateLatest();
  console.log(`🔭 예상 최신 회차: ~${estimated}회`);

  if (currentMax >= estimated && !forceRound) {
    console.log('✅ 이미 최신 상태입니다.');
    fs.writeFileSync(path.join(ROOT, '.latest_round'), String(currentMax));
    process.exit(0);
  }

  // 실제 최신 회차 탐색
  console.log('\n🔍 실제 최신 회차 탐색 중...');
  const latest = await findTrueLatest(estimated);

  if (!latest) {
    console.error('❌ 최신 회차 탐색 실패 (추첨 전이거나 API 오류)');
    process.exit(0); // 에러 exit 아님 — 추첨 전일 수 있음
  }

  const { round: trueLatest } = latest;

  if (trueLatest <= currentMax) {
    console.log(`✅ 이미 최신 상태 (내장: ${currentMax}회 = 실제 최신: ${trueLatest}회)`);
    fs.writeFileSync(path.join(ROOT, '.latest_round'), String(currentMax));
    process.exit(0);
  }

  // 누락 회차 전체 수집
  console.log(`\n📥 ${currentMax + 1}회 ~ ${trueLatest}회 수집 중...`);
  const newRounds = [];

  for (let r = currentMax + 1; r <= trueLatest; r++) {
    process.stdout.write(`  ${r}회 수집 중... `);
    const data = (r === trueLatest && latest.round === r)
      ? latest.data  // 이미 받은 데이터 재사용
      : await fetchRound(r);

    if (data) {
      newRounds.push({ round: r, data });
      console.log(`✅ [${data.n.join(',')} +${data.b}] (${data.d})`);
    } else {
      console.log('⏭️  데이터 없음 (건너뜀)');
    }

    // API 부하 방지
    if (r < trueLatest) await new Promise(res => setTimeout(res, 300));
  }

  if (!newRounds.length) {
    console.log('\n✅ 추가할 데이터 없음');
    fs.writeFileSync(path.join(ROOT, '.latest_round'), String(currentMax));
    process.exit(0);
  }

  // 파일 업데이트
  console.log(`\n✏️  lotto_collector.js 업데이트 중...`);
  const updated = insertRounds(src, newRounds);
  fs.writeFileSync(COLLECTOR, updated, 'utf8');

  // 최신 회차 번호 저장 (커밋 메시지용)
  const newMax = Math.max(...newRounds.map(r => r.round));
  fs.writeFileSync(path.join(ROOT, '.latest_round'), String(newMax));

  console.log(`\n🎉 완료! ${currentMax}회 → ${newMax}회 (${newRounds.length}회차 추가)`);
  newRounds.forEach(({ round, data }) => {
    console.log(`   ${round}회: [${data.n.join(',')}] +${data.b}  (${data.d})`);
  });
}

main().catch(e => {
  console.error('💥 오류 발생:', e);
  process.exit(1);
});
