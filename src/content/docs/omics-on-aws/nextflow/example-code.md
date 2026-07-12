---
title: "Example code"
sidebar:
  order: 0
---

Python으로 Nextflow 작성하기

```python
import os
from textwrap import dedent

os.makedirs('workflows/nf/sample', exist_ok=True)

nf = dedent('''
nextflow.enable.dsl = 2

params.greeting = 'hello'
params.addressee = null

if (!params.addressee) exit 1, "required parameter 'addressee' missing"

process Greet {
    publishDir '/mnt/workflow/pubdir'
    input:
        val greeting
        val addressee
    
    output:
        path "output", emit: output_file
    
    script:
        """
        echo "${greeting} ${addressee}" | tee output
        """
}

workflow {
    Greet(params.greeting, params.addressee)
}

''').strip()

with open('workflows/nf/sample/main.nf', 'wt') as f:
    f.write(nf)
```