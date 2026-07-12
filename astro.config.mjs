// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://aws-ps-korea-tech.github.io',
  base: '/starlight',
  integrations: [
    starlight({
      title: 'AWS PS Tech',
      sidebar: [
        {
          label: 'Amazon S3',
          items: [{ autogenerate: { directory: 'amazon-s3' } }],
        },
        {
          label: '대학 고객을 위한 AWS 길라잡이',
          items: [{ autogenerate: { directory: 'aws' } }],
        },
        {
          label: 'Omics on AWS',
          items: [{ autogenerate: { directory: 'omics-on-aws' } }],
        },
        {
          label: 'AWS Batch',
          items: [{ autogenerate: { directory: 'aws-batch' } }],
        },
        {
          label: 'AWS BLAST Performance Testing',
          items: [{ autogenerate: { directory: 'aws-blast-performance-testing' } }],
        },
      ],
    }),
  ],
});
