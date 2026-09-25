# Blender via MCP
Tools: `mcp__blender__*` (load with ToolSearch query "blender", max_results 40). First: `get_addon_status` + `get_scene_info`.
- Modeling: `execute_blender_code` (bpy). Find shader nodes by type, not name; read enum values before setting.
- After each change: `get_viewport_screenshot`, describe it in the ticket.
- Libraries: Poly Haven / Poly Pizza / Sketchfab search + download tools (check `get_*_status` first).
- AI 3D: `generate_hyper3d_model_via_text/images` (Rodin), `generate_hunyuan3d_model` — may use paid credits → `approval request` unless Boss listed it in config `approvedTools`.
- Export: glTF/GLB (`bpy.ops.export_scene.gltf`) for Godot/Web/Unity; FBX for Unreal. Apply transforms, 1 unit = 1 m.
- One live Blender instance → Producer runs Blender tickets one at a time.
