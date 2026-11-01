---
title: "Store multimodal data with purpose-built Health AI services"
sidebar:
  order: 6
---

# Store multimodal data with purpose-built Health AI services

## 소개 및 실습 준비

본 문서는 [Guidance for Multi-Modal Data Analysis with AWS Health and ML Services](https://aws.amazon.com/solutions/guidance/multi-modal-data-analysis-with-aws-health-and-ml-services/) 를 참고하였으며 여기에 있는 [Open sample code](https://github.com/aws-solutions-library-samples/guidance-for-multi-modal-data-analysis-with-aws-health-and-ml-services)를 참고하여 정리하였습니다.

#### 소개

상기 [Repository](https://github.com/aws-solutions-library-samples/guidance-for-multi-modal-data-analysis-with-aws-health-and-ml-services)에는 AWS Health 및 머신 러닝 서비스를 사용한 멀티모달 데이터 분석을 위한 AWS 가이드와 관련된 코드 샘플이 포함되어 있습니다. 주어진 지침에 따라 게놈, 임상 및 의료 이미징 데이터를 저장, 통합 및 분석하기 위한 엔드투엔드 프레임워크를 구축할 수 있습니다.

예를 들어, FHIR 리소스, MRI DICOM 이미지, 게놈 데이터, 생리학적 데이터(예: 심전도), 간단한 임상 기록이 포함된 오픈 소스 합성 데이터 세트인 [Synthea Coherent Data Set](https://registry.opendata.aws/synthea-coherent-data/)를 사용할 것입니다. 모든 데이터 유형은 FHIR로 서로 연결됩니다. 데모를 위해 이미 게놈 데이터(원래는 변이체 및 주석 정보가 포함된 CSV 파일로 제공됨)를 AWS HealthOmics와 호환되는 VCF 형식으로 변환했습니다. 마찬가지로 임상 데이터도 AWS 헬스레이크와 호환되는 NDJSON 파일로 준비했습니다. 사용 편의성을 위해 이 파생된 데이터 세트를 Amazon S3 버킷(s3://guidance-multimodal-hcls-healthai-machinelearning)에서 공개 액세스를 통해 사용할 수 있도록 했습니다. 일관된 데이터 세트는 심혈관 질환에 초점을 맞추고 있으므로 고혈압, 뇌졸중, 관상동맥 심장 질환, 알츠하이머병과 같은 환자의 결과를 예측하는 사용 사례를 고려하고 있습니다.

![architecture-diagram.png](_assets/e3041a65a6b2.png)

#### 계정 내 사전 준비

모든 데이터 분석 및 AI 모델링은 [Amazon SageMaker](https://aws.amazon.com/sagemaker/)를 사용하여 수행됩니다. 원클릭 배포로 [Amazon SageMaker 도메인](https://docs.aws.amazon.com/ko_kr/sagemaker/latest/dg/sm-domain.html)을 만들 수 있습니다.

[![deployment](https://github.com/aws-solutions-library-samples/guidance-for-multi-modal-data-analysis-with-aws-health-and-ml-services/raw/main/architecture/LaunchStack.jpg)](https://console.aws.amazon.com/cloudformation/home?region=us-east-1#/stacks/create/template?stackName=sagemakerstack&templateURL=https://aws-opendata-demo.s3.amazonaws.com/sagemaker_template.yaml)

![Screenshot 2024-01-30 at 4.15.52 PM.png](_assets/fbad3f0fb469.png)

ParameterSubnet1Id, ParameterSubnet2Id, ParameterVPCId 값을 본인의 계정에 맞게 선택하면 됩니다.

![Screenshot 2024-01-30 at 4.16.13 PM.png](_assets/69deb41e6a86.png)

![Screenshot 2024-01-30 at 4.16.35 PM.png](_assets/a5e6b40ce430.png)

체크박스에 체크를 하고 Submit을 누릅니다.

![Screenshot 2024-01-30 at 4.16.24 PM.png](_assets/2e6657755e91.png)

#### SageMaker 도메인 확인  

앞에서 만들었던 CloudFormation의 Stack이 정상적으로 만들어졌다면, 이제 SageMaker를 사용할 준비가 완료되었습니다.

![Screenshot 2024-01-30 at 4.19.22 PM.png](_assets/55b2e8367408.png)

만들어진 stack에서는 resources 탭을열어보면 관련된 리소스들을 볼 수 있습니다. 관련 IAM Role들이 생성된 것을 확인할 수 있습니다.

![Screenshot 2024-02-09 at 11.32.36 AM.png](_assets/019c7d2eb89c.png)

Amazon SageMaker서비스로 진입합니다.

![Screenshot 2024-01-30 at 4.18.25 PM.png](_assets/a8b9c290ad8b.png)

아래와 같이 Domain에서 만들어진 도메인 목록을 확인할 수 있습니다.

![Screenshot 2024-01-30 at 4.18.54 PM.png](_assets/8a4dd2cd5184.png)

Domain settings 메뉴에서 해당 도메인에서 사용되는 Execution Role을 확인해볼 수 있습니다.

여기서는 Role 이름은 `SageMakerStudioExecutionRole` 입니다.

![Screenshot 2024-02-09 at 11.36.03 AM.png](_assets/e31fb6be24e9.png)

생성된 도메인 내에서 Launch버튼을 눌러 Studio 앱을 실행합니다.

![Screenshot 2024-01-30 at 4.20.24 PM.png](_assets/d00fa6b68c8b.png)

Amazon SageMaker Studio 환경에 접속하였습니다!

![Screenshot 2024-01-30 at 4.20.47 PM.png](_assets/9abfb6d69223.png)

Create JupyterLab space를 눌러서 쥬피터 환경을 만듭니다.

![Screenshot 2024-01-30 at 4.21.46 PM.png](_assets/f8fd5b903beb.png)목록으로 돌아가 환경이 만들어질때까지 대기합니다.

![Screenshot 2024-01-30 at 4.23.08 PM.png](_assets/f8942ed66922.png)

환경이 만들어졌다면 Open 을 선택하여 Jupyter Lab 환경을 시작합니다.

![Screenshot 2024-01-30 at 4.24.01 PM.png](_assets/6b01b5d126b2.png)

터미널을 열고 git clone 명령어로 repository를 로컬로 복제합니다.

![Screenshot 2024-01-30 at 4.24.50 PM.png](_assets/b3a06ea60f57.png)

```bash
git clone https://github.com/aws-solutions-library-samples/guidance-for-multi-modal-data-analysis-with-aws-health-and-ml-services.git
```

![Screenshot 2024-01-30 at 4.24.54 PM.png](_assets/92b3f176d0b7.png)


이번 세션에서는 특수 목적의 헬스 AI 서비스(AWS HealthOmics, AWS HealthLake, AWS HealthImaging)로 멀티모달 데이터를 저장할 수 있습니다.

각 데이터 유형 별로 알맞는 서비스에 저장하려면 해당 폴더에 있는 아티팩트를 따르세요.

- genomic - Run the notebook `store-multimodal-data/genomic/store-analyze-genomicdata-with-awshealthomics.ipynb`. This creates AWS HealthOmics data stores (Reference Store, Variant Store, and Annotation Store) to import reference genome, VCF files, and ClinVar annotation file.
- clinical - Follow the instructions in `store-multimodal-data/clinical/README.md `to create AWS HealthLake data store and import NDJSON files.
- medical imaging - First, run the notebook `store-multimodal-data/medical_imaging/store-imagingdata-with-awshealthimaging.ipynb` to create AWS HealthImaging data stores and import DICOM files. Then, run preprocess-multimodal-date/medical-imaging/imaging-radiomics.ipynb to generate radiomic features from multimple images in parallel using Amazon SageMaker Preprocessing.

### Store multimodal data

[Store multimodal data](https://github.com/aws-solutions-library-samples/guidance-for-multi-modal-data-analysis-with-aws-health-and-ml-services/tree/main/store-multimodal-data) 의 각 폴더의 가이드 또는 코드를 참고하여 진행해주세요.

#### Genomic (유전체학 데이터)  

보다 자세한 참고링크는 https://catalog.workshops.aws/amazon-omics-end-to-end/en-US/020-xp-code/300-omics-analytics/310-querying-data

##### VCF 가져오기 (AWS HealthOmics)  

샘플 VCF를 Import하는데 예시에서 보듯 30분 정도 소요됩니다. 본 예제에서는 889개의 샘플 VCF (0.1Megabyte)를 모두 가져오는데 걸린 시간입니다.

`s3://guidance-multimodal-hcls-healthai-machinelearning-us-east-1/genomic/fastq/Abe604_Frami345_b8dd1798-beef-094d-1be4-f90ee0e6b7d5_dna.vcf`

![Screenshot 2024-01-30 at 5.21.38 PM.png](_assets/2295be310270.png)

![Screenshot 2024-01-30 at 5.34.37 PM.png](_assets/fa82b903ff66.png)

annotation data 도 마찬가지로 가져옵니다. 이 예에서는 59메가바이트 정도의 파일을 가지고 오는데 5분정도 소요되었습니다.

`s3://guidance-multimodal-hcls-healthai-machinelearning-us-east-1/genomic/annotation/clinvar.vcf.gz`

![Screenshot 2024-01-30 at 6.44.00 PM.png](_assets/e256c43b8e09.png)

[여기](https://github.com/aws-solutions-library-samples/guidance-for-multi-modal-data-analysis-with-aws-health-and-ml-services/tree/main/preprocess-multimodal-data)를 참고하면 아래의 수동 생성과정이 불필요할 수 있음.

<div class="Box-sc-g0xbh4-0 fSWWem" id="bkmrk-provide-necessary-pe" style="box-sizing: border-box; padding: 0px; color: rgb(230, 237, 243); font-family: -apple-system, 'system-ui', 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji'; font-size: 14px; font-style: normal; font-variant-ligatures: normal; font-variant-caps: normal; font-weight: 400; letter-spacing: normal; orphans: 2; text-align: start; text-indent: 0px; text-transform: none; widows: 2; word-spacing: 0px; -webkit-text-stroke-width: 0px; white-space: normal; background-color: rgb(13, 17, 23); text-decoration-thickness: initial; text-decoration-style: initial; text-decoration-color: initial; --sticky-pane-height: calc(100vh - (max(0px, 0px)));"><div class="Box-sc-g0xbh4-0 kPPmzM" style="box-sizing: border-box; max-width: 100%; margin-left: auto; margin-right: auto; display: flex; flex-wrap: wrap;"><div class="Box-sc-g0xbh4-0 cIAPDV" style="box-sizing: border-box; display: flex; flex: 1 1 100%; flex-wrap: wrap; max-width: 100%;"><div class="Box-sc-g0xbh4-0 emFMJu" style="box-sizing: border-box; display: flex; flex-direction: column; order: 2; flex: 1 1 0px; -webkit-box-flex: 1; min-width: 1px; margin-right: auto;"><div class="Box-sc-g0xbh4-0 hlUAHL" style="box-sizing: border-box; width: 1485px; max-width: 100%; margin-left: auto; margin-right: auto; -webkit-box-flex: 1; flex-grow: 1; padding: 0px;"><div class="Box-sc-g0xbh4-0 iStsmI" data-selector="repos-split-pane-content" style="box-sizing: border-box; margin-left: auto; margin-right: auto; flex-direction: column; padding-bottom: 40px; max-width: 100%; margin-top: 0px; outline: none;" tabindex="0"><div class="Box-sc-g0xbh4-0 MERGN" style="box-sizing: border-box; margin-left: 16px; margin-right: 16px;"><div class="Box-sc-g0xbh4-0 yfPnm" style="box-sizing: border-box; display: flex; flex-direction: column; gap: 16px;"><div class="Box-sc-g0xbh4-0 faROye" style="box-sizing: border-box; min-width: 0px; display: flex; flex-direction: row; -webkit-box-pack: justify; justify-content: space-between; gap: 16px;"><div class="Box-sc-g0xbh4-0 hcmQVs" id="bkmrk-provide-necessary-pe-1" style="box-sizing: border-box; border-radius: 6px; width: 1453px; border: 1px solid var(--borderColor-default,var(--color-border-default,#30363d));"><div class="Box-sc-g0xbh4-0 bJMeLZ js-snippet-clipboard-copy-unpositioned" data-hpc="true" style="box-sizing: border-box; padding: 32px; overflow: auto;"><article class="markdown-body entry-content container-lg" style="box-sizing: border-box; display: block; max-width: 1012px; margin-right: auto; margin-left: auto; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji'; font-size: 16px; line-height: 1.5; overflow-wrap: break-word;"><span style="color: rgb(236, 240, 241);">Provide necessary permissions to the role</span>

1. Get the execution role of your SageMaker domain. Click on the default user profile and note down the execution role on the right hand side of the page. The role will look like `arn:aws:iam::111122223333:role/service-role/AmazonSageMaker-ExecutionRole-XXXX`. Note down the `AmazonSageMaker-ExecutionRole-XXXX` part as it will be used in the next steps.
2. Go to **Lake Formation** service page and choose **Administrative roles and tasks**.
3. Go to the **Data lake administrators** section and click on **Add**. Under **IAM users and roles**, choose the execution role created in the previous step. Click on **Confirm**.
4. Go to **IAM** service page. Click on **Roles**. Search for the execution role created in the previous step. Click on the execution role.
5. Click on **Add permissions** and **Attach policies**. Select **AmazonAthenaFullAccess** and **Add permissions**.
6. Go back to the SageMaker domain in your SageMaker console. Under **User profiles**, click on **Launch** and select **Studio**. Wait for the Studio to launch.

</article></div></div></div></div></div></div></div><div class="Box-sc-g0xbh4-0" style="box-sizing: border-box;">  
</div></div></div></div></div>##### 데이터베이스 생성 (AWS Lake Formation) 및 Workgroup 생성 (Amazon Athena)  

<p class="callout info">워크그룹 생성</p>

![Screenshot 2024-01-30 at 5.39.53 PM.png](_assets/e8cd879830de.png)

omics라는 이름으로 workgroup을 생성합니다.

![Screenshot 2024-01-30 at 5.38.18 PM.png](_assets/e994b44715c1.png)

Athena쿼리를 위해 Lake Formation에서 데이터베이스를 사전에 생성하여 리소스를 링크합니다.

<p class="callout info">데이터베이스 생성</p>

![Screenshot 2024-01-30 at 5.00.42 PM.png](_assets/210518c6257b.png)

다음과 같이 Database가 생성된 것을 확인할 수 있습니다.

![Screenshot 2024-01-30 at 5.42.09 PM.png](_assets/56fbdfc2f0ab.png)

![Screenshot 2024-01-30 at 4.59.27 PM.png](_assets/6fb0c2064943.png)

\# 데이터에 대해 아테나 쿼리를 실행하려면, AWS Lake Formation을 사용해 데이터베이스에 대한 리소스 링크를 생성하세요.  
\# 다음 기능이 작동하려면 이 노트북을 실행하는 IAM 사용자가 데이터 레이크 관리자인지 확인해야 합니다.

![Screenshot 2024-01-30 at 5.00.12 PM.png](_assets/9c075c91c022.png)

<p class="callout info">리소스 연결</p>

앞에서 VCF 를 HealthOmics에 Import 정상적으로 했다면 AWS Lake Formation의 Tables 목록에서 확인할 수 있습니다.

해당되는 테이블을 체크하고 grant on target를 선택한 뒤 권한을 부여합니다.

![Screenshot 2024-01-30 at 6.28.37 PM.png](_assets/a17d31d29027.png)

![Screenshot 2024-01-30 at 6.28.46 PM.png](_assets/85bed2572f04.png)

![Screenshot 2024-01-30 at 7.04.01 PM.png](_assets/c8a79207a6d8.png)

![Screenshot 2024-01-30 at 6.29.07 PM.png](_assets/efdfdc0026d0.png)

Jupyter에서 불러온 Annotation 테이블 결과 예시입니다.

![Screenshot 2024-01-30 at 7.02.32 PM.png](_assets/cb06cf6fc88c.png)

#### Clinical (임상정보 데이터)   

AWS HealthLake 서비스를 사용하여 임상정보를 저장하고 활용할 수 있습니다. [여기](https://github.com/aws-solutions-library-samples/guidance-for-multi-modal-data-analysis-with-aws-health-and-ml-services/blob/main/store-multimodal-data/clinical/README.md)에 있는 것 처럼 처음에 가장 먼저 할일은 Clinical data를 저장하는 것부터 입니다.

AWS HealthLake 서비스 접속 후 새로운 데이터 스토어 생성

![Screenshot 2024-02-08 at 6.28.09 PM.png](_assets/a0f692a5fe90.png)![Screenshot 2024-02-08 at 6.34.19 PM.png](_assets/90c2de4365a4.png)

사전 준비 필요

```bash
pip install s3fs
```

#### Medical imaging (의료이미지 데이터)

preprocess-imaging.ipynb 을 사용해서 FeatureStore에 저장

![Screenshot 2024-01-30 at 9.04.15 PM.png](_assets/e5e7a02ecc08.png)

imaging-radiomics.ipynb 을 사용해 다음 진행

이때 입력이 되는 dicom 경로를 적절히 수정해야함.

![Screenshot 2024-01-30 at 9.14.31 PM.png](_assets/13f2e72b691c.png)

[여기](https://docs.aws.amazon.com/healthimaging/latest/devguide/getting-started-setting-up.html#setting-up-create-iam-role-import)를 참고하여 SagaMaker 도메인에 적용된 IAM에 필요한 Policy, Trusted policy 적용

![Screenshot 2024-01-30 at 11.11.51 PM.png](_assets/24cdcb96621f.png)

이때 아래 policy 참고 (codebuild:CreatProject 와 iam:PassRole)

[https://raw.githubusercontent.com/aws-samples/amazon-sagemaker-immersion-day/master/iam-policy-sm-cb.txt](https://raw.githubusercontent.com/aws-samples/amazon-sagemaker-immersion-day/master/iam-policy-sm-cb.txt)

AWSCodePipeline에 대한 Policy도 있어야 함.

![Screenshot 2024-01-30 at 11.21.05 PM.png](_assets/8d013d5456dc.png)

### Preprocess multimodal data  

[preprocess-multimodal-data](https://github.com/aws-solutions-library-samples/guidance-for-multi-modal-data-analysis-with-aws-health-and-ml-services/tree/main/preprocess-multimodal-data) 폴더의 각 폴더별 지침/코드를 참고하여 진행해주세요.

<p class="callout info">이때 SageMaker domain은 새로 생성할 필요 없이 [앞에서 만들었던 domain](/genomics-analytics-on-aws/store-multimodal-data-with-purpose-built-health-ai-services/)을 사용할 수 있습니다.</p>
