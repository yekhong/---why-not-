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

## Mandatory ERD & DB Table/Column Impact Analysis System

### 1. Absolute Top Directive
- Every code edit, bug fix, error fix, refactoring, or feature update MUST reference the project's ERD schema ([ERD_SCHEMA_REFERENCE.md](file:///c:/Users/user/Documents/GitHub/---why-not-/ERD_SCHEMA_REFERENCE.md) & [supabase_master_migration_full.sql](file:///c:/Users/user/Documents/GitHub/---why-not-/supabase_master_migration_full.sql)).
- In every response, implementation plan, walkthrough, and code modification report, a dedicated section titled `### 🗄️ ERD & DB 테이블/컬럼 영향도 분석` MUST be included.

### 2. Required Impact Analysis Output Specification
Whenever code is modified, the agent MUST explicitly specify:
1. **영향 받는 테이블 (Affected Tables)**: e.g., `rooms`, `evaluations`
2. **영향 받는 컬럼 및 데이터 타입 (Affected Columns & Data Types)**: e.g., `rooms.status` (`TEXT`), `evaluations.criteria_evaluations` (`JSONB`)
3. **데이터 조작 및 영향 성격 (Mutation & Query Impact)**: Whether it is `INSERT`, `UPDATE`, `DELETE`, `SELECT`, or index/constraint modification, and how data flow changes.
4. **외래키 및 연쇄 영향 (FK & Cascades)**: Cascading deletes, parent/child relationships, and snapshot integrity across tables.

