---
title: "WDL 워크플로우 마이그레이션 하기 (HiFi-human-WGS-WDL)"
sidebar:
  order: 4
---

다음 문서는 WDL 워크플로우를 HealthOmics의 Private workflow에 등록하는 내용을 다루고 있습니다.

대상 워크플로우 주소: [https://github.com/PacificBiosciences/HiFi-human-WGS-WDL](https://github.com/PacificBiosciences/HiFi-human-WGS-WDL)

일단 가장 먼저 해볼만한 일은 이 WDL 워크플로우가 로컬에서 잘 동작하는지 확인해보는 일일 것입니다.

EC2 인스턴스의 사양 역시 문서 내용을 참고 ( 64 cpu cores and 256 GB of RAM) 하여 c6i.32xlarge 에서 테스트했습니다.

<p class="callout warning">EC2 인스턴스의 사양 역시 문서 내용을 참고 ( 64 cpu cores and 256 GB of RAM) 하여 c6i.32xlarge 에서 테스트했습니다.  
**시간당 $5.440 달러**, 비용 참고: https://instances.vantage.sh/aws/ec2/c6i.32xlarge</p>

개발 환경을 위해 tmux, git을 설치했습니다.

```
sudo dnf -y install git tmux tree
```

위 워크플로우 주소의 Readme를 참고하여 관련 파일과 워크플로우 내용을 EC2 인스턴스 상에서 다운로드 받았습니다.

데이터 다운로드

```
wget https://github.com/PacificBiosciences/HiFi-human-WGS-WDL/releases/download/v2.1.1/hifi-human-wgs-singleton.zip
wget https://github.com/PacificBiosciences/HiFi-human-WGS-WDL/releases/download/v2.1.1/hifi-human-wgs-family.zip
```

워크플로우 다운로드

```
git clone \
  --depth 1 --branch v2.1.1 \
  --recursive \
  https://github.com/PacificBiosciences/HiFi-human-WGS-WDL.git
```