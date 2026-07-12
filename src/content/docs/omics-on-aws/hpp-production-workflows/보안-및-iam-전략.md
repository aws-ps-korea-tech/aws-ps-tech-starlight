---
title: "보안 및 IAM 전략"
sidebar:
  order: 5
---

# 보안 및 IAM 전략

## 5.1 HealthOmics IAM 아키텍처

**서비스 연결 역할 (Service-Linked Role):**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "omics.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

**워크플로우 실행 역할 권한:**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::your-genomics-data-bucket/*",
        "arn:aws:s3:::your-genomics-results-bucket/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:log-group:/aws/omics/*"
    }
  ]
}
```

## 5.2 사용자 액세스 관리

**연구자 그룹 (Researcher Role):**
- 워크플로우 실행 권한
- 결과 데이터 읽기 권한
- 비용 모니터링 읽기 권한

**관리자 그룹 (Admin Role):**
- 워크플로우 생성/수정 권한
- IAM 역할 관리 권한
- 전체 리소스 관리 권한

**감사자 그룹 (Auditor Role):**
- 읽기 전용 액세스
- CloudTrail 로그 접근
- 규정 준수 보고서 생성

## 5.3 데이터 보안 및 암호화

**전송 중 암호화:**
- TLS 1.2+ 강제 적용
- S3 HTTPS 엔드포인트 사용
- VPC 엔드포인트를 통한 내부 트래픽

**저장 중 암호화:**
```json
S3 버킷 정책 예시:
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::your-genomics-data-bucket/*",
      "Condition": {
        "StringNotEquals": {
          "s3:x-amz-server-side-encryption": "aws:kms"
        }
      }
    }
  ]
}
```

**KMS 키 관리:**
- 고객 관리형 KMS 키 사용
- 키 순환 활성화 (연간)
- 세분화된 키 사용 권한