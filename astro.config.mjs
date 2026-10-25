// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightSidebarTopics from 'starlight-sidebar-topics';

// Base path is platform-dependent:
//   GitHub Pages serves under /aws-ps-tech-starlight  -> set DEPLOY_BASE=/aws-ps-tech-starlight (CI default)
//   Cloudflare Pages / Netlify serve at root -> leave DEPLOY_BASE unset (= '/')
// This lets the SAME repo deploy to all three; only CF/Netlify give real 301s
// (they read public/_redirects natively), so use those for SEO-critical prod.
const BASE = process.env.DEPLOY_BASE ?? '/';
const SITE = process.env.DEPLOY_SITE ?? 'https://aws-ps-tech-starlight.netlify.app';

export default defineConfig({
  site: SITE,
  base: BASE,
  integrations: [
    starlight({
      title: 'AWS Korea Public Sector SA Team',
      logo: { light: './src/assets/logo-dark.png', dark: './src/assets/logo-light.png', alt: 'AWS', replacesTitle: false },
      favicon: '/favicon.png',
      customCss: ['./src/styles/brand.css'],
      components: {
        Banner: './src/components/Banner.astro',
        Footer: './src/components/Footer.astro',
      },
      pagefind: true,
      plugins: [
        starlightSidebarTopics([
        {
          id: 'start',
        label: "시작하기·계정",
          link: '/aws/',
          items: [
            { label: "대학 고객을 위한 AWS 길라잡이", items: [{ autogenerate: { directory: 'aws' } }] },
            { label: "Amazon S3", items: [{ autogenerate: { directory: 's3' } }] },
          ],
        },
        {
          label: "유전체·오믹스",
          link: '/omics-on-aws/',
          items: [
            { label: "Omics on AWS", items: [{ autogenerate: { directory: 'omics-on-aws' } }] },
            { label: "Genome Data Delivery Portal on AWS", items: [{ autogenerate: { directory: 'genome-data-delivery-portal-on-aws' } }] },
          ],
        },
        {
          label: "HPC·배치·BLAST",
          link: '/aws-batch/',
          items: [
            { label: "AWS Batch", items: [{ autogenerate: { directory: 'aws-batch' } }] },
            { label: "NCBI BLAST on AWS", items: [{ autogenerate: { directory: 'ncbi-blast-on-aws' } }] },
            { label: "AWS BLAST Performance Testing", items: [{ autogenerate: { directory: 'aws-blast-performance-testing' } }] },
          ],
        },
        {
          id: 'ai',
        label: "AI·ML",
          link: '/amazon-bio-discovery-ai/',
          items: [
            { label: "Amazon Bio Discovery로 AI 항체 설계 시작하기", items: [{ autogenerate: { directory: 'amazon-bio-discovery-ai' } }] },
            { label: "AI Agent Memory on AWS", items: [{ autogenerate: { directory: 'ai-agent-memory-on-aws' } }] },
            { label: "Decision Models on AWS", items: [{ autogenerate: { directory: 'decision-models-on-aws' } }] },
          ],
        },
        {
          label: "규제·거버넌스",
          link: '/gxp-on-aws/',
          items: [
            { label: "GxP on AWS", items: [{ autogenerate: { directory: 'gxp-on-aws' } }] },
          ],
        },
      ], {
        // Empty / draft books: built and reachable by URL, shown under a tab's navigation
        // but not listed in its sidebar.
        topics: {
          start: [
            '/egovframework-on-aws', '/egovframework-on-aws/**',
            '/data-transfer', '/data-transfer/**',
            '/fsx-for-lustre', '/fsx-for-lustre/**',
          ],
          ai: ['/draft-gbrain', '/draft-gbrain/**'],
        },
        exclude: ['/'],
      }),
      ],
    }),
  ],
});
