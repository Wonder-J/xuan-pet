- [x] Verify that the copilot-instructions.md file in the .github directory is created.
- [x] Clarify Project Requirements
- [x] Scaffold the Project
- [x] Customize the Project
- [x] Install Required Extensions
- [x] Compile the Project
- [x] Create and Run Task
- [x] Launch the Project
- [x] Ensure Documentation is Complete

Workspace notes:
- Use pnpm workspaces with apps and packages folders.
- Keep API keys in the Electron main process only.
- Treat the 2D pet as an adapter layer so Live2D can be added later.
- Prefer minimal shared packages instead of coupling renderer and main logic.
- No extra VS Code extensions were required for this workspace.