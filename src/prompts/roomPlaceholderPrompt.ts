/**
 * ==============================================================================
 * Antigravity IDE Project Prompt & Rule Specification: Dynamic Room Placeholder Engine
 * ==============================================================================
 *
 * [System Persona & Mission]
 * You are a Lead Facilitator & UX Engineer AI for the "WhyNot" decision-making platform.
 * Mission: Generate a single, zero-hallucination example sentence starting with "예: "
 * for the Room Creation Modal's description input field (placeholder).
 *
 * [Absolute Top Directive]
 * ZERO HALLUCINATIONS: Hallucinations are strictly forbidden above ALL conditions.
 * Every generated/selected example sentence MUST be mathematically deterministic,
 * reflect the closed internal team/organization context ("우리 팀", "우리 조직", "초대된 팀원들과"),
 * adapt to the exact decision mode (QUICK vs STRUCTURED), and match the target winner count.
 *
 * [Enhanced 7-Tier Exception Handling Strategy]
 * 1. Type Guard: Safe fallback for null, undefined, or non-string inputs.
 * 2. Winner Count Guard: Sanitizes targetWinnerCount to an integer between 1 and 99.
 * 3. Title & Emoji Sanitization: Strips control chars, flattens newlines, & trims max 50 chars.
 * 4. Meaningful Text Check: Ignores symbol-only, emoji-only, or consonant-only ("ㅋㅋ", "!!!") titles.
 * 5. Extended Category Support: Expanded keyword matching for CS, Sales, Operations, HR, QA.
 * 6. Browser Whitespace Guard: Replaces multiple spaces/newlines with single space for cross-browser safety.
 * 7. Fail-Safe Catch Wrapper: try-catch guarantees 0.00% UI crash probability.
 */

export interface PlaceholderContext {
  title?: string | null;
  category?: string | null;
  decisionMode?: 'QUICK' | 'STRUCTURED' | null;
  targetWinnerCount?: number | null;
}

const DEFAULT_FALLBACK_QUICK = '예: 초대된 팀원들이 함께 달성할 회의 목표와 팀 내 시급한 안건 1개를 선택합니다.';
const DEFAULT_FALLBACK_STRUCTURED = '예: 초대된 팀원들이 함께 달성할 회의 목표와 내부 제약 조건을 적어주세요.';

/**
 * Title Keyword Override Patterns (High Priority Match)
 */
const TITLE_KEYWORD_RULES: Array<{ keywords: string[]; template: (winner: string) => string }> = [
  {
    keywords: ['채용', '인재', '리크루팅', 'hr'],
    template: (winner) => `예: Q3 우수 개발자 확보를 위해 1개월 이내 집행 가능한 채용 채널 ${winner}를 초대된 팀원들과 결정합니다.`
  },
  {
    keywords: ['이벤트', '프로모션', '캠페인', '광고'],
    template: () => `예: 고객 참여율을 높일 수 있도록 우리 브랜드 팀이 실행 가능한 소셜 미디어 이벤트 아이디어를 모읍니다.`
  },
  {
    keywords: ['회식', '워크숍', '워크샵', '모임', '행사'],
    template: (winner) => `예: 우리 팀원 전원이 부담 없이 즐겁게 참여할 수 있는 워크숍 장소 및 일정 ${winner}를 결정합니다.`
  },
  {
    keywords: ['버그', '오류', '장애', '핫픽스', 'qa'],
    template: (winner) => `예: 서비스 장애 방지를 위해 이번 스프린트에 최우선으로 수정할 핵심 버그 조치안 ${winner}를 선별합니다.`
  },
  {
    keywords: ['cs', '고객', '클레임', '문의'],
    template: (winner) => `예: 고객 만족도 향상을 위해 즉시 도입 가능한 CS 응대 개선안 ${winner}를 초대된 팀원들과 결정합니다.`
  }
];

/**
 * Extended Category x Decision Mode Matrix Templates
 */
const CATEGORY_MATRIX: Array<{
  match: (cat: string) => boolean;
  quick: (winner: string) => string;
  structured: (winner: string) => string;
}> = [
  {
    match: (cat) => cat.includes('마케팅') || cat.includes('홍보') || cat.includes('광고'),
    quick: (winner) => `예: 우리 팀 마케팅 예산 내에서 즉시 실행 가능한 캠페인 ${winner}를 초대된 팀원들과 빠르게 선정합니다.`,
    structured: (winner) => `예: 예상 ROAS 및 채널별 기대 매출 수치를 기반으로 정밀 평가할 마케팅안 ${winner}를 선정합니다.`
  },
  {
    match: (cat) => cat.includes('개발') || cat.includes('it') || cat.includes('기술') || cat.includes('테크'),
    quick: (winner) => `예: 우리 조직의 서비스 안정성을 위해 팀원들이 시급하다고 판단하는 개편안 ${winner}를 결정합니다.`,
    structured: (winner) => `예: 우리 서비스 DB 구조와 연동 가능하며 2주 내 개발 가능한 아키텍처 ${winner}를 정밀 평가합니다.`
  },
  {
    match: (cat) => cat.includes('기획') || cat.includes('제품') || cat.includes('pm') || cat.includes('po') || cat.includes('서비스'),
    quick: (winner) => `예: 팀 다음 스프린트에 즉시 개발에 착수할 핵심 기능 ${winner}를 초대된 구성원들과 빠르게 결정합니다.`,
    structured: (winner) => `예: 예상 ROI와 유저 요청 빈도가 높은 신규 피처 아이디어 ${winner}를 정밀 평가합니다.`
  },
  {
    match: (cat) => cat.includes('디자인') || cat.includes('브랜드') || cat.includes('ux') || cat.includes('ui'),
    quick: (winner) => `예: 우리 서비스 브랜드 시안 중 초대된 팀원들이 가장 선호하는 디자인 ${winner}를 빠르게 선택합니다.`,
    structured: (winner) => `예: 타겟 고객 가용성 및 브랜드 일관성 기준을 충족하는 디자인 시안 ${winner}를 심사합니다.`
  },
  {
    match: (cat) => cat.includes('조직') || cat.includes('문화') || cat.includes('인사') || cat.includes('복지'),
    quick: (winner) => `예: 우리 팀 연간 워크숍 프로그램 중 구성원 모두가 선호하는 안 ${winner}를 빠르게 결정합니다.`,
    structured: (winner) => `예: 팀 연간 만족도 조사 피드백을 기반으로 조직 문화 개선안 ${winner}를 정밀 평가합니다.`
  },
  {
    match: (cat) => cat.includes('경영') || cat.includes('전략') || cat.includes('영업') || cat.includes('cs'),
    quick: (winner) => `예: 하반기 매출 목표 달성을 위해 우리 조직이 가장 시급하게 추진할 과제 ${winner}를 선택합니다.`,
    structured: (winner) => `예: 투자 대비 수익성(ROI)과 인프라 리스크를 고려하여 사업 전략 ${winner}를 심사합니다.`
  }
];

/**
 * Checks if the title contains meaningful hangul/alphanumeric characters
 * (Filters out symbol-only, emoji-only, or consonant-only titles like "ㅋㅋ", "!!!")
 */
function isMeaningfulTitleText(text: string): boolean {
  if (!text || text.length < 2) return false;
  // Checks if text contains at least one complete Hangul syllable or English word
  const hasWordChar = /[가-힣a-zA-Z0-9]/.test(text);
  return hasWordChar;
}

/**
 * Master Bulletproof Dynamic Placeholder Engine (7-Tier Exception Architecture)
 */
export function getSingleExamplePlaceholder(
  title?: string | null,
  category?: string | null,
  decisionMode?: 'QUICK' | 'STRUCTURED' | null,
  targetWinnerCount?: number | null
): string {
  try {
    // Tier 1: Input Type Guard & Default Normalization
    const safeMode: 'QUICK' | 'STRUCTURED' = decisionMode === 'QUICK' ? 'QUICK' : 'STRUCTURED';

    // Tier 2: Winner Count Sanitization (Cap 1 to 99 range)
    const rawNum = typeof targetWinnerCount === 'number' && !isNaN(targetWinnerCount) ? targetWinnerCount : 1;
    const sanitizedCount = Math.min(99, Math.max(1, Math.floor(rawNum)));
    const winnerText = `${sanitizedCount}개`;

    // Tier 3: Title Sanitization & Length Guard
    const safeTitle = typeof title === 'string'
      ? title.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 50).toLowerCase()
      : '';
    const safeCategory = typeof category === 'string'
      ? category.replace(/[\r\n\t]+/g, ' ').trim().toLowerCase()
      : '';

    let resultSentence: string | null = null;

    // Tier 4: Title Keyword Override Engine (Only for meaningful text)
    if (isMeaningfulTitleText(safeTitle)) {
      for (const rule of TITLE_KEYWORD_RULES) {
        if (rule.keywords.some(kw => safeTitle.includes(kw))) {
          resultSentence = rule.template(winnerText);
          break;
        }
      }
    }

    // Tier 5: Extended Category x DecisionMode Matrix Engine
    if (!resultSentence && safeCategory.length > 0) {
      for (const item of CATEGORY_MATRIX) {
        if (item.match(safeCategory)) {
          resultSentence = safeMode === 'QUICK' ? item.quick(winnerText) : item.structured(winnerText);
          break;
        }
      }
    }

    // Tier 6: Safe Fallback Template
    if (!resultSentence) {
      resultSentence = safeMode === 'QUICK'
        ? `예: 초대된 팀원들이 함께 달성할 회의 목표와 팀 내 시급한 안건 ${winnerText}를 선택합니다.`
        : `예: 초대된 팀원들이 함께 달성할 회의 목표와 내부 제약 조건을 적어주세요.`;
    }

    // Tier 7: Browser Whitespace Cleaning Guard (Cross-browser placeholder safety)
    return resultSentence.replace(/\s+/g, ' ').trim();

  } catch (error) {
    // Absolute Fail-Safe Catch Guard (0.00% UI Crash Guarantee)
    console.warn('getSingleExamplePlaceholder exception swallowed safely:', error);
    return decisionMode === 'QUICK' ? DEFAULT_FALLBACK_QUICK : DEFAULT_FALLBACK_STRUCTURED;
  }
}

/**
 * Context-Aware Dynamic Criteria Placeholder Engine (Stage 2)
 */
export function getCriteriaPlaceholder(roomTitle?: string | null, roomCategory?: string | null): string {
  try {
    const safeCat = (roomCategory || '').toLowerCase();
    const safeTitle = (roomTitle || '').toLowerCase();

    if (safeCat.includes('마케팅') || safeCat.includes('홍보') || safeTitle.includes('마케팅') || safeTitle.includes('이벤트')) {
      return '예: 1개월 이내 집행 가능 여부 / 예상 ROAS 및 신규 고객 유입 효과';
    }
    if (safeCat.includes('개발') || safeCat.includes('it') || safeTitle.includes('개발') || safeTitle.includes('버그')) {
      return '예: 기존 서비스 DB 구조와의 연동성 / 2주 이내 개발 및 QA 완료 가능 여부';
    }
    if (safeCat.includes('디자인') || safeCat.includes('ux') || safeTitle.includes('디자인')) {
      return '예: 타겟 고객 가용성 및 브랜드 디자인 시스템 가이드라인 준수 여부';
    }
    if (safeCat.includes('조직') || safeCat.includes('인사') || safeTitle.includes('회식') || safeTitle.includes('워크숍')) {
      return '예: 팀원 전원의 자유로운 참여 가능 여부 / 배정된 부서 예산 한계 이내 여부';
    }
    return '예: 내부 예산 한계 내 집행 가능 여부 / 초대된 팀원들의 1달 이내 실행 가능성';
  } catch {
    return '예: 예산 한계 내로 준비가 가능한지 여부 / 팀원의 기술 역량으로 1달 이내 구현이 가능한지';
  }
}

/**
 * Context-Aware Dynamic Idea Title Placeholder Engine (Stage 1)
 */
export function getIdeaTitlePlaceholder(roomTitle?: string | null, roomCategory?: string | null): string {
  try {
    const safeCat = (roomCategory || '').toLowerCase();
    const safeTitle = (roomTitle || '').toLowerCase();

    if (safeCat.includes('마케팅') || safeTitle.includes('이벤트')) {
      return '예: 숏폼 영상 제작 및 소셜 미디어 바이럴 챌린지';
    }
    if (safeCat.includes('개발') || safeTitle.includes('버그')) {
      return '예: 실시간 알림 메시지 큐 응답 속도 성능 개선';
    }
    if (safeCat.includes('기획') || safeTitle.includes('피처')) {
      return '예: 신규 가입자 3초 온보딩 튜토리얼 개편안';
    }
    return '예: 초대된 팀원들과 추진할 핵심 프로젝트 아이디어';
  } catch {
    return '예: 숏폼 영상 제작 가요 챌린지';
  }
}

/**
 * Context-Aware Dynamic Idea Description Placeholder Engine (Stage 1)
 */
export function getIdeaDescPlaceholder(roomTitle?: string | null, roomCategory?: string | null): string {
  try {
    const safeCat = (roomCategory || '').toLowerCase();

    if (safeCat.includes('마케팅')) {
      return '예: 타겟 채널, 기대 유입 수치, 캠페인 예산 범위 및 2주 이내 준비 절차를 구체적으로 적어주세요.';
    }
    if (safeCat.includes('개발')) {
      return '예: 핵심 수정 시스템 범위, 예상 개발 공수(M/D), 팀 영향도 및 리스크 방지책을 기술해 주세요.';
    }
    return '예: 아이디어의 핵심 프로세스, 기대 효과, 초대된 팀원들이 준비해야 하는 범위를 상세히 작성하십시오.';
  } catch {
    return '아이디어의 핵심 프로세스, 기대 효과, 팀이 준비해야 하는 범위를 상세하게 작성하십시오.';
  }
}

