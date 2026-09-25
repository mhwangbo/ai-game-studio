# ComfyUI (local image / texture / concept generation)
Install path: set `engines.comfyui` in `.studio/config.json` (ask Boss once, then record it). Default server http://127.0.0.1:8188.
- Running? `curl -s http://127.0.0.1:8188/system_stats`. Not running → ask Boss to start it (or use a launch command recorded in LESSONS).
- Use installed models only: list `<ComfyUI>/models/checkpoints`, `loras`, etc. New model = `approval request --kind model` with name, size, license, URL.
- API: POST API-format workflow JSON to `/prompt`, poll `/history/<id>`, fetch `/view?filename=...`. Keep reusable workflows in project `Tools/ComfyWorkflows/`.
- Game art: fixed seed per asset family, StyleGuide prompt prefix, flat background then remove bg, downscale to target pixel density, consistent perspective.
- One worker on the GPU at a time.
