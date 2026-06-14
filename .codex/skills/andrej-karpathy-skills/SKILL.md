---
name: andrej-karpathy-skills
description: Project coding discipline based on Andrej Karpathy-style LLM coding guidance. Use before writing, reviewing, or refactoring code in this repository to keep changes simple, surgical, verified, committed, pushed, and validated against the real Figma client when FigBoost behavior changes.
---

# Andrej Karpathy Skills

Use this project skill before starting code work in this repository.

## 1. Think Before Coding

State assumptions explicitly. If a request has multiple reasonable interpretations, name them before changing code. If the request is unclear enough that a reasonable assumption would be risky, ask one concise question.

## 2. Simplicity First

Write the minimum code that solves the requested problem. Do not add speculative features, one-off abstractions, broad configurability, or unrelated error handling. If the implementation starts becoming large, re-check whether a smaller local change solves the same user-visible issue.

## 3. Surgical Changes

Touch only the files and lines needed for the request. Match the existing project style. Do not refactor adjacent code, reformat unrelated files, or delete pre-existing dead code unless the user explicitly asks. Clean up only unused code introduced by the current change.

## 4. Goal-Driven Verification

Define success in verifiable terms before finishing. For bug fixes, reproduce or exercise the failing path when feasible. For behavior changes, run the smallest meaningful automated checks plus any project-specific manual checks needed to prove the flow works.

## 5. GitHub Handoff

After modifying code or project files:
- Run meaningful verification for the change.
- Commit the completed change with a clear Chinese commit message.
- Push the commit to GitHub `main`.
- If push fails, report the exact blocker and leave the local commit ready to push.

## 6. Real Figma Verification

For changes that affect FigBoost behavior:
- Build the updated `FigBoost.exe` when the executable is part of the deliverable.
- Apply the relevant install, uninstall, feature, or update flow to the real installed Figma Desktop client.
- Start or confirm the real Figma client is running after the flow when the behavior requires it.
- Capture a screenshot proving the relevant UI or flow state.
- State clearly if real-client screenshot verification cannot be completed.
