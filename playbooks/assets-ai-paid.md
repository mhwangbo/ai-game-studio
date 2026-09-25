# Paid / account AI tools — approval ALWAYS first
| Tool | Use | How |
|---|---|---|
| ElevenLabs | VO, SFX, music | Boss logs in; connected creative MCP (`creative_generate_speech`, voices) if available |
| Higgsfield | video, cinematics, trailers | Boss logs in via browser; agent drives UI only after approval |
| Hyper3D Rodin / Hunyuan3D / Meshy / Tripo | text/image → 3D | via Blender MCP where available |
| creative MCP image/video generation | concept art, marketing | may bill — request first |

Flow: `approval request "<tool>: <what>, est $X" --kind spend --cost X --why "<why free options don't work>"` → wait for APPROVED in pulse → do it → note actual cost in a ticket comment.
Never type passwords or API keys. If a key is needed, Boss sets it (env var or tool UI).
