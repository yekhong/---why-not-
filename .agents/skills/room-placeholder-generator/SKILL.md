---
name: room-placeholder-generator
description: Deterministically generates a zero-hallucination single example placeholder string ("예: ...") for room creation/edit description textareas based on title keywords, category, decision mode, and target winner count.
---

# Dynamic Room Placeholder Generator Skill

## Overview
This skill provides a 0ms, zero-cost, zero-hallucination dynamic placeholder generator for room description input fields.

## Core Rules & Constraints
1. **Zero Hallucination**: No random LLM hallucinated outputs. All sentence generation is 100% deterministic.
2. **Single Example**: Returns exactly 1 placeholder string beginning with `예: `.
3. **Internal Team Context**: Uses collaborative team phrasing (`우리 팀`, `우리 조직`, `초대된 팀원들과`).
4. **Dynamic Winner Count**: Adapts `${targetWinnerCount}개` to match room settings.
5. **7-Tier Guard**: Null/Type guard, Winner count cap, Title sanitization, Meaningful text check, Extended category matrix, Cross-browser whitespace cleaning, and `try-catch` fail-safe.

## Source Code Reference
- Rule Engine: `src/prompts/roomPlaceholderPrompt.ts` -> `getSingleExamplePlaceholder()`
- Room Creation Modal: `src/App.tsx` Line 3300
- Room Edit Modal: `src/App.tsx` Line 6744
