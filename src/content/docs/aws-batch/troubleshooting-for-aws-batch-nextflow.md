---
title: "Troubleshooting for AWS Batch & Nextflow"
---

# Troubleshooting for AWS Batch & Nextflow

**CannotPullImageManifestError: Error response from daemon: manifest unknown: manifest unknown**

![image.png](_assets/6e623ee32985.png)

![image.png](_assets/2d2140d54e5f.png)

**Solution**

Check your docker image.

![Screenshot 2024-12-26 at 9.41.27 PM.png](_assets/1d64d1e7ef46.png)

**bash: aws: command not found**

![image.png](_assets/a482aa35ac5d.png)

**Solution**

Check your container image has the aws cli program.

[https://www.nextflow.io/docs/latest/aws.html#custom-ami](https://www.nextflow.io/docs/latest/aws.html#custom-ami)

**ERROR ~ Pipeline failed. Please refer to troubleshooting docs: [https://nf-co.re/docs/usage/troubleshooting](https://nf-co.re/docs/usage/troubleshooting)**

![image.png](_assets/0de92d0225be.png)

Solution

Check the .nextflow.log file content. There may be various causes, but this appears to be because the token has expired.

![Screenshot 2024-12-29 at 12.23.07 AM.png](_assets/99e3b49d0bd2.png)
