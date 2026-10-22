---
title: "Rstudio 실습환경 자동화 구성"
---

# Rstudio 실습환경 자동화 구성

<p class="callout info">Amazon EC2의 Ubuntu 24버전 기준으로 아래 문서를 작성했습니다. 아래 내용은 시간이 지남에 따라 적절히 작동하지 않을 수 있으므로 필요한대로 수정하고 확인하는 것을 추천드립니다!</p>

Amazon EC2의 [User data 기능](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/user-data.html)을 사용하기 위해 User Data내용을 파일로 만들어둡니다.

여기 예에서는 install\_rstudio.txt라고 파일을 만들었습니다.

```bash
#!/bin/bash

# update indices
apt update -qq
# install two helper packages we need
apt install -y --no-install-recommends software-properties-common dirmngr
# add the signing key (by Michael Rutter) for these repos
# To verify key, run gpg --show-keys /etc/apt/trusted.gpg.d/cran_ubuntu_key.asc
# Fingerprint: E298A3A825C0D65DFD57CBB651716619E084DAB9
wget -qO- https://cloud.r-project.org/bin/linux/ubuntu/marutter_pubkey.asc | tee -a /etc/apt/trusted.gpg.d/cran_ubuntu_key.asc
# add the repo from CRAN -- lsb_release adjusts to 'noble' or 'jammy' or ... as needed
add-apt-repository -y "deb https://cloud.r-project.org/bin/linux/ubuntu $(lsb_release -cs)-cran40/"

# Install R
apt install -y --no-install-recommends r-base

# Install RStudio dependencies
apt install -y gdebi-core

# Install R pkacage dependencies
apt install -y build-essential

wget https://download2.rstudio.org/server/jammy/amd64/rstudio-server-2024.12.1-563-amd64.deb

gdebi -n rstudio-server-2024.12.1-563-amd64.deb

# Add rstudio user and set password
useradd -m -s /bin/bash rstudio
echo "rstudio:rstudio" | chpasswd

R -e "options(HTTPUserAgent = sprintf('R/%s R (%s)', getRversion(), paste(getRversion(), R.version['platform'], R.version['arch'], R.version['os']))); install.packages('TwoSampleMR', repos = c('https://mrcieu.r-universe.dev/bin/linux/noble/4.4/', 'https://p3m.dev/cran/__linux__/noble/latest', 'https://cloud.r-project.org'))"
```

**이제 다음과 같은 명령어로 EC2를 실행할 수 있습니다. 이 부분이 어렵다면 Amazon EC2 콘솔에서 먼저 진행 후 Command line을 완성하는 것을 추천드립니다.**

```
export AMI_ID={Ubuntu 나 필요한 OS가 설치된 Base AMI}
export INSTANCE_TYPE=t3.large
export KEY_NAME={본인의 KeyName}

# 이외에도 security group (sg-로 시작하는 것들)과 SnapshotId는 본인의 맞게 설정합니다.

aws ec2 run-instances --image-id "${AMI_ID}" --instance-type "${INSTANCE_TYPE}" --key-name "${KEY_NAME}" \
    --user-data file://install_rstudio.txt \
    --block-device-mappings '{"DeviceName":"/dev/sda1","Ebs":{"Encrypted":false,"DeleteOnTermination":true,"Iops":3000,"SnapshotId":"snap-0dbe62bb8f1f21357","VolumeSize":100,"VolumeType":"gp3","Throughput":125}}' \
    --network-interfaces '{"AssociatePublicIpAddress":true,"DeviceIndex":0,"Groups":["sg-0d2f7724e68ddff15","sg-0e2c103f2a28a9be7"]}' \
    --credit-specification '{"CpuCredits":"unlimited"}' --tag-specifications '{"ResourceType":"instance","Tags":[{"Key":"Name","Value":"rstudio server"}]}' \
    --metadata-options '{"HttpEndpoint":"enabled","HttpPutResponseHopLimit":2,"HttpTokens":"required"}' \
    --private-dns-name-options '{"HostnameType":"ip-name","EnableResourceNameDnsARecord":true,"EnableResourceNameDnsAAAARecord":false}' \
    --count "1" --region ap-northeast-2
```

**EC2로 접속해봅니다. 인스턴스 구성이 예상한대로 잘되었다면 아래와 같이 AMI로 만들수 있습니다.**

```
aws ec2 create-image \
    --instance-id {본인의 대상 인스턴스 아이디} \
    --name "My Rstudio server" \
    --description "An AMI for my Rstudio server with TwoSampleMR R package" \
    --region ap-northeast-2
```

**이제 만들어진 AMI로 원하는 수와 설정내용으로 새로운 인스턴스를 실행해보세요!**

<p class="callout warning">대규모 인스턴스 수의 실습환경을 제공시 사전에 실습 환경 구성을 해둘 것을 권장합니다. 아래 설명한 인스턴스 생성에대한 Quota 제한도 존재할 수 있고 예기치못한 상황이 있을 수 있으므로 반드시 실습 환경을 실제로 운영하기 시작 전에 충분한 시간을 가지고 인스턴스를 미리 만들어 두는 것을 추천합니다.</p>

<p class="callout warning">AWS에서는 기본 서비스 Quota가 존재합니다. 예를들어 계정 내의 API 초당 요청수, Ec2 인스턴스 요청 수 등이 그 예입니다.  
[https://docs.aws.amazon.com/general/latest/gr/aws\_service\_limits.html](https://docs.aws.amazon.com/general/latest/gr/aws_service_limits.html)  
다음을 참고하여 필요한 만큼 Quota를 사전에 늘리시는 것을 권장드립니다.  
https://docs.aws.amazon.com/servicequotas/latest/userguide/request-quota-increase.html</p>
