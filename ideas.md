# AI 바둑 기보 분석 리포트 - 디자인 아이디어

## 선택된 디자인 철학: "바둑판 위의 데이터 연구소"

<response>
<text>
**Design Movement**: 동양 미니멀리즘 + 데이터 저널리즘 (East Asian Minimalism × Data Journalism)

**Core Principles**:
1. 바둑판의 격자(Grid) 구조를 UI의 기본 언어로 삼아, 모든 레이아웃이 바둑의 교점(交點)에서 영감을 받은 듯한 느낌을 준다.
2. 정보 계층(Information Hierarchy)을 엄격하게 적용하여 "패착"이라는 핵심 정보가 즉각적으로 눈에 들어오도록 한다.
3. 동양적 여백(Negative Space)의 미학을 살려 복잡한 데이터를 차분하고 권위 있게 제시한다.
4. 흑돌과 백돌의 대비를 색상 시스템으로 확장하여 흑(Black)과 골드(Gold)의 조합으로 고급스러움을 표현한다.

**Color Philosophy**:
- 배경: 깊은 숯색(Charcoal) `#1A1A1A` — 바둑판의 어두운 나무 질감을 연상
- 카드 배경: 약간 밝은 다크 `#242424`
- 강조색: 따뜻한 골드 `#C9A84C` — 패착 표시, 중요 수치 강조
- 흑돌: 순수 블랙 `#111111`
- 백돌: 아이보리 화이트 `#F5F0E8`
- 텍스트: 연한 크림 `#E8E0D0`
- 위험 표시: 부드러운 붉은색 `#E05252`

**Layout Paradigm**:
- 상단 헤더: 대국 정보 요약 (대국자, 날짜, 총 수, 최종 승률)
- 좌측 사이드바: 전체 패착 목록 (네비게이션 역할)
- 우측 메인 영역: 선택된 패착의 상세 해설 카드 + 미니 바둑판

**Signature Elements**:
1. 바둑판 격자 패턴을 배경 텍스처로 사용 (매우 미묘하게)
2. 패착 카드의 헤더에 승률 하락을 시각화하는 미니 바(Bar) 그래프
3. 미니 바둑판에서 PV 수순의 돌들이 순서대로 나타나는 애니메이션

**Interaction Philosophy**:
- 카드 호버 시 미세한 골드 테두리 빛남 효과
- PV 뷰어 버튼 클릭 시 카드가 아래로 부드럽게 확장
- 다국어 전환 시 텍스트 페이드 인/아웃

**Animation**:
- 페이지 로드: 카드들이 아래에서 위로 순차적으로 페이드 인 (stagger: 150ms)
- PV 확장: height 0 → auto, 300ms ease-out
- 돌 배치: 각 돌이 0.1초 간격으로 scale(0) → scale(1) 애니메이션

**Typography System**:
- 헤더/제목: Noto Serif KR (한자 계열 세리프, 권위 있는 느낌)
- 본문/해설: Noto Sans KR (가독성 최우선)
- 수치/좌표: JetBrains Mono (코드 느낌의 모노스페이스)
</text>
<probability>0.07</probability>
</response>
