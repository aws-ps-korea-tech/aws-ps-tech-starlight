---
title: "Troubleshooting for AWS Batch & Nextflow"
sidebar:
  order: 1
---

**CannotPullImageManifestError: Error response from daemon: manifest unknown: manifest unknown**

[![image.png](./_images/XGOimage.png)](https://www.aws-ps-tech.kr/uploads/images/gallery/2024-12/XGOimage.png)

[![image.png](./_images/GyXimage.png)](https://www.aws-ps-tech.kr/uploads/images/gallery/2024-12/GyXimage.png)

**Solution**

Check your docker image.

[![Screenshot 2024-12-26 at 9.41.27 PM.png](./_images/screenshot-2024-12-26-at-9-41-27-pm.png)](https://www.aws-ps-tech.kr/uploads/images/gallery/2024-12/screenshot-2024-12-26-at-9-41-27-pm.png)

**bash: aws: command not found**

[![image.png](./_images/3aiimage.png)](https://www.aws-ps-tech.kr/uploads/images/gallery/2024-12/3aiimage.png)

**Solution**

Check your container image has the aws cli program.

[https://www.nextflow.io/docs/latest/aws.html#custom-ami](https://www.nextflow.io/docs/latest/aws.html#custom-ami)

**ERROR ~ Pipeline failed. Please refer to troubleshooting docs: [https://nf-co.re/docs/usage/troubleshooting](https://nf-co.re/docs/usage/troubleshooting)**

[![image.png](./_images/Dvrimage.png)](https://www.aws-ps-tech.kr/uploads/images/gallery/2024-12/Dvrimage.png)

Solution

Check the .nextflow.log file content. There may be various causes, but this appears to be because the token has expired.

[![Screenshot 2024-12-29 at 12.23.07 AM.png](./_images/screenshot-2024-12-29-at-12-23-07-am.png)](https://www.aws-ps-tech.kr/uploads/images/gallery/2024-12/screenshot-2024-12-29-at-12-23-07-am.png)