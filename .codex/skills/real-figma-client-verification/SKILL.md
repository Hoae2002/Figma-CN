---
name: real-figma-client-verification
description: Use when Codex writes, edits, fixes, refactors, or reviews code in this FigBoost/Figma Desktop patch project and must verify the result in the real installed Figma Desktop client after code changes. Applies to runtime code, build scripts, installer or patch logic, UI hooks, export flows, menu/popup behavior, and any change that can affect FigBoost behavior.
---

# Real Figma Client Verification

## Core Rule

After every code modification in this repository, verify the relevant behavior in the real installed Figma Desktop client before calling the work complete whenever the change can affect runtime behavior.

Static checks, unit tests, mock Electron windows, generated screenshots, or self-tests are useful but do not replace real-client proof.

## Workflow

1. Run the smallest meaningful automated checks first, such as unit tests, script tests, or build checks for the touched area.
2. If the executable, payload, patch, installer, or runtime assets changed, build the updated deliverable such as `FigBoost.exe`.
3. Apply or install the updated build to the real local Figma Desktop environment using the project's normal flow.
4. Start or foreground the real installed Figma Desktop client, not a mock window or browser-only simulation.
5. Exercise the user-visible flow affected by the code change, such as menu popup display, update checks, batch export, install/uninstall, or injected UI behavior.
6. Capture full-screen evidence with `fullscreen-screenshot-verification`, including DPI-aware physical resolution on 2K or larger displays.
7. Inspect the screenshot before making a claim. Repeat after important clicks or state changes.
8. In the handoff, report the tested OS, screenshot path, screenshot dimensions, visible result, and any click coordinates used.

## Boundaries

- For documentation, skill-only, or other non-code project-file changes, validate the changed artifact directly; real Figma verification is not required unless runtime behavior changed.
- For OS-specific bugs, do not claim another OS proves the fix. If a Win10-only bug is tested on Win11, state that Win10 remains unverified.
- If the real Figma client cannot be opened, patched, or driven, state the exact blocker and what verification did run.
- Do not push or declare a code fix complete without either real-client proof or an explicit blocker explaining why that proof could not be completed.
