# Project Rules

- Do NOT automatically add or update modification logs in `구인회.md`.

## Zero-Hallucination Dynamic Room Placeholder Rule System

### 1. Absolute Top Directive
- **Zero Hallucination Guarantee**: Hallucinations are strictly forbidden above ALL conditions.
- Every generated/selected placeholder example sentence MUST be mathematically deterministic.

### 2. Output Formatting & Layout Specs
- Format: Single sentence starting with `예: `
- Length: 35 ~ 50 characters (single-line UI placeholder layout)
- Context: Closed Internal Team / Organization collaboration (`우리 팀`, `우리 조직`, `초대된 팀원들과`, `내부 예산/아키텍처`)
- Dynamic Winner Count Adaptation: Always syncs with `${targetWinnerCount}개`

### 3. Execution & Code File Location
- Code Implementation: `src/prompts/roomPlaceholderPrompt.ts` -> `getSingleExamplePlaceholder(...)`
- Frontend Binding: `src/App.tsx` Room Creation Modal `<textarea placeholder={...}>`
- Architecture: 7-Tier Fail-Safe Guard (0.00% UI crash guarantee)

