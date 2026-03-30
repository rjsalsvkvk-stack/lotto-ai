/**
 * ============================================================
 *  LOTTO STATS MODULE  (lotto_stats.js)
 *  역할: DB 기반 통계 계산 · 번호 분석 · 로컬 번호 생성 로직
 *
 *  의존: LottoCollector (lotto_collector.js)
 *
 *  공개 API:
 *    LottoStats.compute(db)          → statsObj   전체 통계 객체 반환
 *    LottoStats.buildPromptContext() → string      AI 프롬프트용 컨텍스트 문자열
 *    LottoStats.generateLocal()      → Array[10]   로컬 폴백 번호 생성
 * ============================================================
 */

const LottoStats = (() => {

  // ──────────────────────────────────────────────────────────
  //  내부: 전체 빈도 계산
  //  exBonus: 보너스 번호 제외 여부 (기본 true)
  // ──────────────────────────────────────────────────────────
  function _freq(db, exBonus = true) {
    const f = {};
    for (let i = 1; i <= 45; i++) f[i] = 0;
    Object.values(db).forEach(d => {
      d.n.forEach(n => f[n]++);
      if (!exBonus) f[d.b]++;
    });
    return f;
  }

  // ──────────────────────────────────────────────────────────
  //  내부: 최근 N회 빈도 계산
  // ──────────────────────────────────────────────────────────
  function _recentFreq(db, lastN = 30) {
    const f = {};
    for (let i = 1; i <= 45; i++) f[i] = 0;
    const rounds = Object.keys(db).map(Number).sort((a, b) => b - a).slice(0, lastN);
    rounds.forEach(r => { if (db[r]) db[r].n.forEach(n => f[n]++); });
    return f;
  }

  // ──────────────────────────────────────────────────────────
  //  내부: AC값 계산 (Adjacent Coupling)
  //  서로 다른 연속 번호 간격의 수 - 5
  // ──────────────────────────────────────────────────────────
  function _acValue(nums) {
    const diffs = new Set();
    for (let i = 0; i < nums.length; i++)
      for (let j = i + 1; j < nums.length; j++)
        diffs.add(nums[j] - nums[i]);
    return diffs.size - 5;
  }

  // ──────────────────────────────────────────────────────────
  //  내부: 번호 세트 품질 점수 평가
  // ──────────────────────────────────────────────────────────
  function _evalSet(nums, freq, avg, strat) {
    let sc = 0;

    // 홀짝 비율
    const odds = nums.filter(n => n % 2 === 1).length;
    if (odds >= 2 && odds <= 4) sc += 20;
    if (odds === 3)              sc += 10;

    // 합계 범위
    const sum = nums.reduce((a, b) => a + b, 0);
    if (sum >= 100 && sum <= 170) sc += 25;

    // 구간 분산 (1~10 / 11~20 / 21~30 / 31~40 / 41~45)
    const zones = new Set(nums.map(n => Math.ceil(n / 10)));
    sc += zones.size * 6;
    if (zones.size >= 4) sc += 10;

    // AC값
    const ac = _acValue(nums);
    if (ac >= 7) sc += 15;
    if (ac >= 9) sc += 5;

    // 연속 번호 (최대 2쌍 허용)
    let cons = 0;
    for (let i = 0; i < nums.length - 1; i++)
      if (nums[i + 1] - nums[i] === 1) cons++;
    if (cons <= 2) sc += 10;
    if (cons === 0) sc -= 5; // 연속 없으면 오히려 약간 감점 (자연스러움)

    // 빈도 전략별 보너스
    const fs = nums.reduce((s, n) => s + freq[n], 0) / 6;
    if (strat === 'hot'     && fs > avg)  sc += 15;
    if (strat === 'cold'    && fs < avg)  sc += 15;
    if (strat === 'balanced') {
      if (fs >= avg * 0.85 && fs <= avg * 1.15) sc += 15;
    }
    if (strat === 'claude') {
      // Claude Pick 특별 조건 - 모든 지표 균형
      if (odds >= 2 && odds <= 4)               sc += 10;
      if (sum >= 110 && sum <= 160)             sc += 10;
      if (zones.size >= 4)                      sc += 15;
      if (fs >= avg * 0.9 && fs <= avg * 1.1)  sc += 10;
    }

    return sc;
  }

  // ──────────────────────────────────────────────────────────
  //  내부: 전략별 가중치 번호 1세트 생성
  // ──────────────────────────────────────────────────────────
  function _genOne(freq, rf, avg, strat) {
    const w = {};
    for (let i = 1; i <= 45; i++) {
      switch (strat) {
        case 'hot':
          w[i] = Math.pow(freq[i] / avg, 1.8) * (1 + rf[i] * 0.1);
          break;
        case 'cold':
          w[i] = Math.pow(avg / Math.max(freq[i], 1), 1.8);
          break;
        case 'pattern':
          w[i] = 1 + rf[i] * 0.3;
          break;
        case 'claude': {
          const fs = Math.pow(freq[i] / avg, 1.2);
          const rs = 1 + rf[i] * 0.2;
          w[i] = fs * rs * (0.8 + Math.random() * 0.4);
          break;
        }
        default: // balanced
          w[i] = 0.7 + (freq[i] / avg) * 0.5 + rf[i] * 0.05;
      }
    }

    const nums = [];
    const avail = Array.from({ length: 45 }, (_, i) => i + 1);
    for (let p = 0; p < 6; p++) {
      const tw = avail.reduce((s, n) => s + (w[n] || 0), 0);
      let r = Math.random() * tw;
      let ch = avail[0];
      for (const n of avail) { r -= w[n] || 0; if (r <= 0) { ch = n; break; } }
      nums.push(ch);
      avail.splice(avail.indexOf(ch), 1);
    }
    return nums.sort((a, b) => a - b);
  }

  // ──────────────────────────────────────────────────────────
  //  공개: 전체 통계 계산
  //  반환 statsObj:
  //  {
  //    freq:    { 1..45: count },      전체 빈도
  //    rf30:    { 1..45: count },      최근 30회 빈도
  //    rf10:    { 1..45: count },      최근 10회 빈도
  //    avg:     Number,                전체 평균 빈도
  //    sorted:  [[num, cnt], ...],     전체 빈도 내림차순
  //    sortedR: [[num, cnt], ...],     최근 빈도 내림차순
  //    total:   Number,                총 회차 수
  //    maxRound:Number,
  //    last5:   [{round, n, b, d}, ...]  최근 5회
  //  }
  // ──────────────────────────────────────────────────────────
  function compute(db) {
    const freq   = _freq(db);
    const rf30   = _recentFreq(db, 30);
    const rf10   = _recentFreq(db, 10);
    const total  = Object.keys(db).length;
    const avg    = Object.values(freq).reduce((a, b) => a + b, 0) / 45;
    const sorted  = Object.entries(freq).map(([n, c]) => [Number(n), c]).sort((a, b) => b[1] - a[1]);
    const sortedR = Object.entries(rf30).map(([n, c]) => [Number(n), c]).sort((a, b) => b[1] - a[1]);
    const maxRound = Math.max(...Object.keys(db).map(Number));

    const last5 = Object.keys(db).map(Number).sort((a, b) => b - a).slice(0, 5)
      .map(r => ({ round: r, ...db[r] }));

    return { freq, rf30, rf10, avg, sorted, sortedR, total, maxRound, last5 };
  }

  // ──────────────────────────────────────────────────────────
  //  공개: AI 프롬프트용 통계 컨텍스트 문자열 생성
  // ──────────────────────────────────────────────────────────
  function buildPromptContext(stats) {
    const topAll  = stats.sorted.slice(0, 10).map(([n, c]) => `${n}(${c})`).join(',');
    const botAll  = stats.sorted.slice(-10).map(([n, c]) => `${n}(${c})`).join(',');
    const hotR    = stats.sortedR.slice(0, 10).map(([n, c]) => `${n}(${c})`).join(',');
    const coldR   = stats.sortedR.slice(-10).map(([n, c]) => `${n}(${c})`).join(',');
    const ctx5    = stats.last5.map(e => `${e.round}회: ${e.n.join(',')}+${e.b}`).join('\n');

    return {
      total:   stats.total,
      topAll,
      botAll,
      hotR,
      coldR,
      ctx5,
      sortedAll:    stats.sorted,
      sortedRecent: stats.sortedR
    };
  }

  // ──────────────────────────────────────────────────────────
  //  공개: 로컬 폴백 번호 생성 (Claude API 실패 시 사용)
  //  10세트: claude(1) · hot(1) · balanced(4) · cold(2) · pattern(2)
  // ──────────────────────────────────────────────────────────
  function generateLocal(db) {
    const freq  = _freq(db);
    const rf    = _recentFreq(db, 30);
    const avg   = Object.values(freq).reduce((a, b) => a + b, 0) / 45;

    const TAGS   = ['claude','hot','balanced','balanced','balanced','balanced','cold','cold','pattern','pattern'];
    const results = [];
    const usedKeys = new Set();

    for (let t = 0; t < 10; t++) {
      const strat   = TAGS[t];
      const attempts = strat === 'claude' ? 2000 : 800;
      let best = null, bestScore = -Infinity;

      for (let a = 0; a < attempts; a++) {
        const nums = _genOne(freq, rf, avg, strat);
        const key  = nums.join(',');
        if (usedKeys.has(key)) continue;

        const sc = _evalSet(nums, freq, avg, strat);
        if (sc > bestScore) { bestScore = sc; best = nums; }
      }

      if (best) {
        usedKeys.add(best.join(','));
        results.push({ nums: best, tag: strat, reason: '로컬 통계 엔진' });
      }
    }
    return results;
  }

  // ──────────────────────────────────────────────────────────
  //  공개: 번호별 빈도 조회 (UI용)
  // ──────────────────────────────────────────────────────────
  function getNumberFreq(db, num) {
    const f = _freq(db);
    return f[num] || 0;
  }

  return { compute, buildPromptContext, generateLocal, getNumberFreq };

})(); // end LottoStats
