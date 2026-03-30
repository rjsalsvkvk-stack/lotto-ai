# 🎲 로또 6/45 AI 번호 생성기

매주 토요일 밤 **자동으로 최신 회차를 업데이트**하는 로또 AI 번호 생성기입니다.

## 🔄 자동 업데이트 구조

```
매주 토요일 21:10 (KST)
        ↓
GitHub Actions 실행
        ↓
동행복권 공식 API 직접 호출 (서버 환경 → CORS 없음)
        ↓
lotto_collector.js BUILT_IN_DB 자동 업데이트
        ↓
Git 커밋 & 푸시
        ↓
GitHub Pages 자동 재배포
        ↓
사용자에게 최신 데이터 제공
```

## 🚀 GitHub 설정 방법 (최초 1회)

### 1단계 — 저장소 생성

1. GitHub에서 **New Repository** 클릭
2. Repository name: `lotto-ai` (원하는 이름)
3. **Public** 선택 (GitHub Pages 무료 사용)
4. **Create repository**

---

### 2단계 — 파일 업로드

아래 파일들을 저장소에 업로드합니다:

```
📁 저장소 루트
├── lotto_main.html          ← 메인 페이지
├── lotto_collector.js       ← 데이터 수집 모듈 (자동 업데이트 대상)
├── lotto_stats.js           ← 통계 계산 모듈
├── package.json             ← Node.js 설정
├── scripts/
│   └── fetch_latest.js      ← 자동 업데이트 스크립트
└── .github/
    └── workflows/
        ├── update_lotto.yml ← 매주 토요일 실행
        └── deploy_pages.yml ← Pages 자동 배포
```

**방법 A — 웹 업로드:**
GitHub 저장소 → `Add file` → `Upload files` → 전체 파일 드래그

**방법 B — Git 명령어:**
```bash
git clone https://github.com/YOUR_USERNAME/lotto-ai.git
cd lotto-ai
# 파일 복사 후
git add .
git commit -m "🎲 초기 업로드"
git push origin main
```

---

### 3단계 — GitHub Pages 활성화

1. 저장소 → **Settings** 탭
2. 왼쪽 메뉴 → **Pages**
3. Source: **GitHub Actions** 선택
4. 저장

---

### 4단계 — Actions 권한 설정

1. 저장소 → **Settings** → **Actions** → **General**
2. **Workflow permissions** 항목에서
3. ✅ **Read and write permissions** 선택
4. **Save**

---

### 5단계 — 첫 배포 실행

1. 저장소 → **Actions** 탭
2. `🌐 GitHub Pages 배포` 클릭
3. **Run workflow** → **Run workflow**
4. 완료 후 `https://YOUR_USERNAME.github.io/lotto-ai/lotto_main.html` 접속

---

## 🛠️ 수동 업데이트 방법

추첨 후 바로 업데이트하고 싶을 때:

1. 저장소 → **Actions** 탭
2. `🎲 로또 최신 회차 자동 업데이트` 클릭
3. **Run workflow**
4. (선택) `force_round` 입력란에 특정 회차 번호 입력

---

## 📊 파일 역할

| 파일 | 역할 |
|------|------|
| `lotto_collector.js` | 내장 DB(1~최신회) + CORS 프록시 수집 모듈 |
| `lotto_stats.js` | 빈도 통계 계산 + 로컬 번호 생성 엔진 |
| `lotto_main.html` | UI + AI 번호 생성 + 행운번호 모듈 |
| `scripts/fetch_latest.js` | GitHub Actions용 자동 수집 스크립트 |

---

## ⚠️ 주의사항

- 통계 분석 기반 참고용이며, 당첨을 보장하지 않습니다
- 건전한 복권 구매를 권장합니다
