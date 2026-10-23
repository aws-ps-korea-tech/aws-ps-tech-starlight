// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// Base path is platform-dependent:
//   GitHub Pages serves under /starlight  -> set DEPLOY_BASE=/starlight (CI default)
//   Cloudflare Pages / Netlify serve at root -> leave DEPLOY_BASE unset (= '/')
// This lets the SAME repo deploy to all three; only CF/Netlify give real 301s
// (they read public/_redirects natively), so use those for SEO-critical prod.
const BASE = process.env.DEPLOY_BASE ?? '/';
const SITE = process.env.DEPLOY_SITE ?? 'https://aws-ps-korea-tech.github.io';

export default defineConfig({
  site: SITE,
  base: BASE,
  integrations: [
    starlight({
      title: 'AWS PS Tech',
      pagefind: true,
      sidebar: [
        { label: "AI Agent Memory on AWS", autogenerate: { directory: "ai-agent-memory-on-aws" } },
        { label: "Amazon Bio Discovery로 AI 항체 설계 시작하기", autogenerate: { directory: "amazon-bio-discovery-ai" } },
        { label: "대학 고객을 위한 AWS 길라잡이", autogenerate: { directory: "aws" } },
        { label: "AWS Batch", autogenerate: { directory: "aws-batch" } },
        { label: "AWS BLAST Performance Testing", autogenerate: { directory: "aws-blast-performance-testing" } },
        { label: "Data Transfer", autogenerate: { directory: "data-transfer" } },
        { label: "Decision Models on AWS", autogenerate: { directory: "decision-models-on-aws" } },
        { label: "[DRAFT] gbrain 검색 파이프라인 이해하기", autogenerate: { directory: "draft-gbrain" } },
        { label: "eGovFramework on AWS", autogenerate: { directory: "egovframework-on-aws" } },
        { label: "FSx for Lustre", autogenerate: { directory: "fsx-for-lustre" } },
        { label: "Genome Data Delivery Portal on AWS", autogenerate: { directory: "genome-data-delivery-portal-on-aws" } },
        { label: "NCBI BLAST on AWS", autogenerate: { directory: "ncbi-blast-on-aws" } },
        { label: "Omics on AWS", autogenerate: { directory: "omics-on-aws" } },
        { label: "s3", autogenerate: { directory: "s3" } }
      ],
    }),
  ],
});
