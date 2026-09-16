# Third-party notices

Pathways' own source and documentation are covered by [LICENSE](LICENSE).
Third-party code and packages retain their respective licenses and notices.
The project license does not relicense upstream dependencies.

| Material | Retained notice |
| --- | --- |
| Vendored shadcn Tailwind stylesheet, `vendor/shadcn-tailwind-4.13.0.css` | [shadcn MIT license](vendor/shadcn-tailwind-4.13.0.LICENSE.md) |
| License retained from the original Sites build scaffold | [OpenAI MIT notice](build/sites-vite-plugin.LICENSE) |

The active build uses Next.js and the checked-in Dockerfile; the retained scaffold
license does not mean a Sites build service is needed. UI primitives and npm
packages also have upstream licenses. `package-lock.json` records the resolved
packages and their license metadata; inspect each installed package's license
files when redistributing it. Preserve the applicable notices with distributed
copies. React Flow attribution remains visible in the dependency map.
