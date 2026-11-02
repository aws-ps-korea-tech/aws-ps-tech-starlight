// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

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
      // One flat book list, same books and order as the BookStack book list.
      // Books that are not public in BookStack (data-transfer, decision-models-on-aws, draft-gbrain)
      // are built and reachable by URL but not listed.
      sidebar: [
        { label: "[DRAFT] ISMS-P on AWS", collapsed: true, items: [{ autogenerate: { directory: 'draft-isms-p-on-aws' } }] },
        { label: "AI Agent Memory on AWS", collapsed: true, items: [{ autogenerate: { directory: 'ai-agent-memory-on-aws' } }] },
        { label: "Amazon Bio Discovery로 AI 항체 설계 시작하기", collapsed: true, items: [{ autogenerate: { directory: 'amazon-bio-discovery-ai' } }] },
        { label: "Amazon S3", collapsed: true, items: [{ autogenerate: { directory: 's3' } }] },
        { label: "AWS Batch", collapsed: true, items: [{ autogenerate: { directory: 'aws-batch' } }] },
        { label: "AWS BLAST Performance Testing", collapsed: true, items: [{ autogenerate: { directory: 'aws-blast-performance-testing' } }] },
        { label: "eGovFramework on AWS", collapsed: true, items: [{ autogenerate: { directory: 'egovframework-on-aws' } }] },
        { label: "FSx for Lustre", collapsed: true, items: [{ autogenerate: { directory: 'fsx-for-lustre' } }] },
        { label: "Genome Data Delivery Portal on AWS", collapsed: true, items: [{ autogenerate: { directory: 'genome-data-delivery-portal-on-aws' } }] },
        { label: "GxP on AWS", collapsed: true, items: [{ autogenerate: { directory: 'gxp-on-aws' } }] },
        { label: "NCBI BLAST on AWS", collapsed: true, items: [{ autogenerate: { directory: 'ncbi-blast-on-aws' } }] },
        { label: "Omics on AWS", collapsed: true, items: [{ autogenerate: { directory: 'omics-on-aws' } }] },
        { label: "대학 고객을 위한 AWS 길라잡이", collapsed: true, items: [{ autogenerate: { directory: 'aws' } }] },
      ],
    }),
  ],
});
