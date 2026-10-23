# Starlight — 호스팅 옵션별 배포 설정

같은 리포를 3개 플랫폼에 올릴 수 있습니다. **CF Pages / Netlify만 진짜 301**(루트 서빙 + `public/_redirects`), GitHub Pages는 meta-refresh + `/starlight` 서브패스입니다.

| 플랫폼 | build command | output | base path | 301 | 설정파일 |
|---|---|---|---|---|---|
| **Cloudflare Pages** | `npm run build` | `dist` | `/` (루트) | ✅ 진짜 | 대시보드 설정(아래) |
| **Netlify** | `npm run build` | `dist` | `/` (루트) | ✅ 진짜 | `netlify.toml` (포함됨) |
| **GitHub Pages** | (자동) | `dist` | `/starlight` | ❌ meta | `.github/workflows/deploy.yml` |

## Cloudflare Pages 연결 (권장 — 진짜 301 + 커스텀 도메인 무료)
1. dash.cloudflare.com → Workers & Pages → Create → Pages → Connect to Git
2. 리포 `aws-ps-korea-tech/starlight` 선택
3. 빌드 설정:
   - Framework preset: **Astro**
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Environment variables: (없음 — DEPLOY_BASE 미설정 = 루트 `/`)
4. 배포 후 Custom domains에서 원 도메인 연결 → `public/_redirects`의 108개 301 규칙이 자동 적용됨

## Netlify 연결
- Add new site → Import from Git → `starlight` 선택. `netlify.toml`이 빌드/출력을 지정. `_redirects` 자동 적용.

## GitHub Pages
- Settings → Pages → Source = "GitHub Actions". 이미 워크플로 포함. `/starlight` 서브패스, 301은 meta-refresh.
