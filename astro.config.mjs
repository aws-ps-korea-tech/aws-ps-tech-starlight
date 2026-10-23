// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// Base path is platform-dependent:
//   GitHub Pages serves under /starlight  -> set DEPLOY_BASE=/starlight (CI default)
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
      title: 'AWS PS Tech',
      pagefind: true,
      sidebar: [
        { label: "AI Agent Memory on AWS", items: [{ autogenerate: { directory: "ai-agent-memory-on-aws" } }] },
        { label: "Amazon Bio Discovery로 AI 항체 설계 시작하기", items: [{ autogenerate: { directory: "amazon-bio-discovery-ai" } }] },
        { label: "대학 고객을 위한 AWS 길라잡이", items: [{ autogenerate: { directory: "aws" } }] },
        { label: "AWS Batch", items: [{ autogenerate: { directory: "aws-batch" } }] },
        { label: "AWS BLAST Performance Testing", items: [{ autogenerate: { directory: "aws-blast-performance-testing" } }] },
        { label: "Data Transfer", items: [{ autogenerate: { directory: "data-transfer" } }] },
        { label: "Decision Models on AWS", items: [{ autogenerate: { directory: "decision-models-on-aws" } }] },
        { label: "[DRAFT] gbrain 검색 파이프라인 이해하기", items: [{ autogenerate: { directory: "draft-gbrain" } }] },
        { label: "eGovFramework on AWS", items: [{ autogenerate: { directory: "egovframework-on-aws" } }] },
        { label: "FSx for Lustre", items: [{ autogenerate: { directory: "fsx-for-lustre" } }] },
        { label: "Genome Data Delivery Portal on AWS", items: [{ autogenerate: { directory: "genome-data-delivery-portal-on-aws" } }] },
        { label: "NCBI BLAST on AWS", items: [{ autogenerate: { directory: "ncbi-blast-on-aws" } }] },
        { label: "Omics on AWS", items: [{ autogenerate: { directory: "omics-on-aws" } }] },
        { label: "s3", items: [{ autogenerate: { directory: "s3" } }] }
      ],
    }),
  ],
});
