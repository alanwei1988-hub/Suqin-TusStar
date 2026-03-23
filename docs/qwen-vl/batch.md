阿里云百炼提供与 OpenAI 兼容的 Batch File API，支持以文件方式批量提交任务，系统将异步执行，任务完成或达到最长等待时间时返回结果，费用仅为实时调用的 **50%**。适用于数据分析、模型评测等对时效性要求不高但需要大批量处理的业务。

如需在控制台操作，请参见[批量推理](https://help.aliyun.com/zh/model-studio/batch-inference)。

## **工作流程**

![image](https://help-static-aliyun-doc.aliyuncs.com/assets/img/zh-CN/4732663771/CAEQaxiBgIDB5qWk4BkiIDViYzQ0MWUwNTYyNDQ3NDM5NzM0ZTc4N2Y3NTU2NjA56318723_20260129171731.699.svg)

## **前提条件**

支持通过OpenAI SDK（Python、Node.js）或HTTP API调用 Batch File接口。

## **适用范围**

### 中国内地

在[中国内地部署模式](https://help.aliyun.com/zh/model-studio/regions/#080da663a75xh)下，接入点与数据存储均位于**北京地域**，模型推理计算资源仅限于中国内地。

**支持的模型**

### 国际

在[国际部署模式](https://help.aliyun.com/zh/model-studio/regions/#080da663a75xh)下，接入点与数据存储均位于**新加坡地域**，模型推理计算资源在全球范围内动态调度（不含中国内地）。

**支持的模型**：qwen-max、qwen-plus、qwen-turbo。

## **快速开始**

在处理正式任务前，可使用测试模型`batch-test-model`进行全链路闭环测试。测试模型会跳过推理过程，直接返回一个固定的成功响应，用于验证 API 调用链路和数据格式是否正确。

### **第 1 步：准备输入文件**

准备一个名为[test\_model.jsonl](https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20250403/ilveat/test_model.jsonl)的文件，内容如下：

```json
{"custom_id":"1","method":"POST","url":"/v1/chat/ds-test","body":{"model":"batch-test-model","messages":[{"role":"system","content":"You are a helpful assistant."},{"role":"user","content":"你好！有什么可以帮助你的吗？"}]}}
{"custom_id":"2","method":"POST","url":"/v1/chat/ds-test","body":{"model":"batch-test-model","messages":[{"role":"system","content":"You are a helpful assistant."},{"role":"user","content":"What is 2+2?"}]}}
```

### **第 2 步：运行代码**

根据使用的编程语言，选择以下示例代码并将其保存在输入文件的同一目录下，然后运行。代码将完成文件上传、创建任务、轮询状态和下载结果的完整流程。

> 如需调整文件路径或其他参数，请根据实际情况修改代码。

示例代码

## OpenAI Python SDK

```python
import os
from pathlib import Path
from openai import OpenAI
import time

# 初始化客户端
client = OpenAI(
    # 若没有配置环境变量，可用阿里云百炼API Key将下行替换为：api_key="sk-xxx"，但不建议在生产环境中直接将API Key硬编码到代码中，以减少API Key泄露风险。
    # 新加坡和北京地域的API Key不同。
    api_key=os.getenv("DASHSCOPE_API_KEY"),
    # 以下是北京地域base_url，如果使用新加坡地域的模型，需要将base_url替换为：https://dashscope-intl.aliyuncs.com/compatible-mode/v1
    # 注意：切换地域时，API Key也需要对应更换
    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1"  # 阿里云百炼服务的base_url
)

def upload_file(file_path):
    print(f"正在上传包含请求信息的JSONL文件...")
    file_object = client.files.create(file=Path(file_path), purpose="batch")
    print(f"文件上传成功。得到文件ID: {file_object.id}\n")
    return file_object.id

def create_batch_job(input_file_id):
    print(f"正在基于文件ID，创建Batch任务...")
    # 请注意:此处endpoint参数值需和输入文件中的url字段保持一致.测试模型(batch-test-model)填写/v1/chat/ds-test,Embedding文本向量模型填写/v1/embeddings,其他模型填写/v1/chat/completions
    batch = client.batches.create(input_file_id=input_file_id, endpoint="/v1/chat/ds-test", completion_window="24h")
    print(f"Batch任务创建完成。 得到Batch任务ID: {batch.id}\n")
    return batch.id

def check_job_status(batch_id):
    print(f"正在检查Batch任务状态...")
    batch = client.batches.retrieve(batch_id=batch_id)
    print(f"Batch任务状态: {batch.status}\n")
    return batch.status

def get_output_id(batch_id):
    print(f"正在获取Batch任务中执行成功请求的输出文件ID...")
    batch = client.batches.retrieve(batch_id=batch_id)
    print(f"输出文件ID: {batch.output_file_id}\n")
    return batch.output_file_id

def get_error_id(batch_id):
    print(f"正在获取Batch任务中执行错误请求的输出文件ID...")
    batch = client.batches.retrieve(batch_id=batch_id)
    print(f"错误文件ID: {batch.error_file_id}\n")
    return batch.error_file_id

def download_results(output_file_id, output_file_path):
    print(f"正在打印并下载Batch任务的请求成功结果...")
    content = client.files.content(output_file_id)
    # 打印部分内容以供测试
    print(f"打印请求成功结果的前1000个字符内容: {content.text[:1000]}...\n")
    # 保存结果文件至本地
    content.write_to_file(output_file_path)
    print(f"完整的输出结果已保存至本地输出文件result.jsonl\n")

def download_errors(error_file_id, error_file_path):
    print(f"正在打印并下载Batch任务的请求失败信息...")
    content = client.files.content(error_file_id)
    # 打印部分内容以供测试
    print(f"打印请求失败信息的前1000个字符内容: {content.text[:1000]}...\n")
    # 保存错误信息文件至本地
    content.write_to_file(error_file_path)
    print(f"完整的请求失败信息已保存至本地错误文件error.jsonl\n")

def main():
    # 文件路径
    input_file_path = "test_model.jsonl"  # 可替换为您的输入文件路径
    output_file_path = "result.jsonl"  # 可替换为您的输出文件路径
    error_file_path = "error.jsonl"  # 可替换为您的错误文件路径
    try:
        # Step 1: 上传包含请求信息的JSONL文件,得到输入文件ID,如果您需要输入OSS文件,可将下行替换为：input_file_id = "实际的OSS文件URL或资源标识符"
        input_file_id = upload_file(input_file_path)
        # Step 2: 基于输入文件ID,创建Batch任务
        batch_id = create_batch_job(input_file_id)
        # Step 3: 检查Batch任务状态直到结束
        status = ""
        while status not in ["completed", "failed", "expired", "cancelled"]:
            status = check_job_status(batch_id)
            print(f"等待任务完成...")
            time.sleep(10)  # 等待10秒后再次查询状态
        # 如果任务失败,则打印错误信息并退出
        if status == "failed":
            batch = client.batches.retrieve(batch_id)
            print(f"Batch任务失败。错误信息为:{batch.errors}\n")
            print(f"参见错误码文档: https://help.aliyun.com/zh/model-studio/developer-reference/error-code")
            return
        # Step 4: 下载结果：如果输出文件ID不为空,则打印请求成功结果的前1000个字符内容，并下载完整的请求成功结果到本地输出文件;
        # 如果错误文件ID不为空,则打印请求失败信息的前1000个字符内容,并下载完整的请求失败信息到本地错误文件.
        output_file_id = get_output_id(batch_id)
        if output_file_id:
            download_results(output_file_id, output_file_path)
        error_file_id = get_error_id(batch_id)
        if error_file_id:
            download_errors(error_file_id, error_file_path)
            print(f"参见错误码文档: https://help.aliyun.com/zh/model-studio/developer-reference/error-code")
    except Exception as e:
        print(f"An error occurred: {e}")
        print(f"参见错误码文档: https://help.aliyun.com/zh/model-studio/developer-reference/error-code")

if __name__ == "__main__":
    main()
```

## OpenAI Node.js SDK

```javascript
/**
 * 阿里云百炼 Batch API 测试 - 使用 OpenAI Node.js SDK
 *
 * 安装依赖：npm install openai
 * 运行：node test-nodejs.js
 */

const OpenAI = require('openai');
const fs = require('fs');

// 北京地域的 Base URL
const BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
// 如果使用新加坡地域，使用以下 URL：
// const BASE_URL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';

const apiKey = process.env.DASHSCOPE_API_KEY;
if (!apiKey) {
    console.error('错误: 请设置环境变量 DASHSCOPE_API_KEY');
    process.exit(1);
}

// 初始化客户端
const client = new OpenAI({
    apiKey: apiKey,
    baseURL: BASE_URL
});

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
    try {
        console.log('=== 开始 Batch API 测试 ===\n');

        // Step 1: 上传文件
        console.log('步骤 1: 上传包含请求信息的 JSONL 文件...');
        const fileStream = fs.createReadStream('test_model.jsonl');
        const fileObject = await client.files.create({
            file: fileStream,
            purpose: 'batch'
        });
        const fileId = fileObject.id;
        console.log(`✓ 文件上传成功，文件ID: ${fileId}\n`);

        // Step 2: 创建 Batch 任务
        console.log('步骤 2: 创建 Batch 任务...');
        const batch = await client.batches.create({
            input_file_id: fileId,
            endpoint: '/v1/chat/ds-test',  // 测试模型使用 /v1/chat/ds-test
            completion_window: '24h'
        });
        const batchId = batch.id;
        console.log(`✓ Batch 任务创建成功，任务ID: ${batchId}\n`);

        // Step 3: 轮询任务状态
        console.log('步骤 3: 等待任务完成...');
        let status = batch.status;
        let pollCount = 0;
        let latestBatch = batch;

        while (!['completed', 'failed', 'expired', 'cancelled'].includes(status)) {
            await sleep(10000); // 等待 10 秒
            latestBatch = await client.batches.retrieve(batchId);
            status = latestBatch.status;
            pollCount++;
            console.log(`  [${pollCount}] 任务状态: ${status}`);
        }

        console.log(`\n✓ 任务已完成，最终状态: ${status}\n`);

        // Step 4: 处理结果
        if (status === 'completed') {
            console.log('步骤 4: 下载结果文件...');

            // 下载成功结果
            const outputFileId = latestBatch.output_file_id;
            if (outputFileId) {
                console.log(`  输出文件ID: ${outputFileId}`);
                const content = await client.files.content(outputFileId);
                const text = await content.text();
                console.log('\n--- 成功结果（前 500 字符）---');
                console.log(text.substring(0, Math.min(500, text.length)));
                console.log('...\n');
            }

            // 下载错误文件（如有）
            const errorFileId = latestBatch.error_file_id;
            if (errorFileId) {
                console.log(`  错误文件ID: ${errorFileId}`);
                const errorContent = await client.files.content(errorFileId);
                const errorText = await errorContent.text();
                console.log('\n--- 错误信息 ---');
                console.log(errorText);
            }

            console.log('\n=== 测试成功完成 ===');
        } else if (status === 'failed') {
            console.error('\n✗ Batch 任务失败');
            if (latestBatch.errors) {
                console.error('错误信息:', latestBatch.errors);
            }
            console.error('\n请参考错误码文档: https://help.aliyun.com/zh/model-studio/developer-reference/error-code');
        } else {
            console.log(`\n任务状态: ${status}`);
        }

    } catch (error) {
        console.error('发生错误:', error.message);
        console.error(error);
    }
}

main();
```

## Java（HTTP）

```java
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.Scanner;

/**
 * 阿里云百炼 Batch API 测试 - 使用 HTTP API 调用
 *
 * 前置条件：
 * 1. 确保已经设置环境变量 DASHSCOPE_API_KEY
 * 2. 准备好测试文件 test_model.jsonl（在项目根目录）
 *
 * 地域配置说明：
 * - 北京地域：https://dashscope.aliyuncs.com/compatible-mode/v1
 * - 新加坡地域：https://dashscope-intl.aliyuncs.com/compatible-mode/v1
 */
public class BatchAPITest {

    // 北京地域的 Base URL（默认）
    private static final String BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
    // 如果使用新加坡地域，请将上面的 BASE_URL 替换为：
    // private static final String BASE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";

    private static String API_KEY;

    public static void main(String[] args) throws Exception {
        // 从环境变量获取 API Key
        API_KEY = System.getenv("DASHSCOPE_API_KEY");
        if (API_KEY == null || API_KEY.isEmpty()) {
            System.err.println("错误: 请设置环境变量 DASHSCOPE_API_KEY");
            System.exit(1);
        }

        System.out.println("=== 开始 Batch API 测试 ===\n");

        try {
            // Step 1: 上传文件
            System.out.println("步骤 1: 上传包含请求信息的 JSONL 文件...");
            String fileId = uploadFile("test_model.jsonl");
            System.out.println("✓ 文件上传成功，文件ID: " + fileId + "\n");

            // Step 2: 创建 Batch 任务
            System.out.println("步骤 2: 创建 Batch 任务...");
            String batchId = createBatch(fileId);
            System.out.println("✓ Batch 任务创建成功，任务ID: " + batchId + "\n");

            // Step 3: 轮询任务状态
            System.out.println("步骤 3: 等待任务完成...");
            String status = "";
            int pollCount = 0;

            while (!isTerminalStatus(status)) {
                Thread.sleep(10000); // 等待 10 秒
                String batchInfo = getBatch(batchId);
                status = parseStatus(batchInfo);
                pollCount++;
                System.out.println("  [" + pollCount + "] 任务状态: " + status);

                // Step 4: 如果完成，下载结果
                if ("completed".equals(status)) {
                    System.out.println("\n✓ 任务已完成！\n");
                    System.out.println("步骤 4: 下载结果文件...");

                    String outputFileId = parseOutputFileId(batchInfo);
                    if (outputFileId != null && !outputFileId.isEmpty()) {
                        System.out.println("  输出文件ID: " + outputFileId);
                        String content = getFileContent(outputFileId);
                        System.out.println("\n--- 成功结果（前 500 字符）---");
                        System.out.println(content.substring(0, Math.min(500, content.length())));
                        System.out.println("...\n");
                    }

                    String errorFileId = parseErrorFileId(batchInfo);
                    if (errorFileId != null && !errorFileId.isEmpty() && !"null".equals(errorFileId)) {
                        System.out.println("  错误文件ID: " + errorFileId);
                        String errorContent = getFileContent(errorFileId);
                        System.out.println("\n--- 错误信息 ---");
                        System.out.println(errorContent);
                    }

                    System.out.println("\n=== 测试成功完成 ===");
                    break;
                } else if ("failed".equals(status)) {
                    System.err.println("\n✗ Batch 任务失败");
                    System.err.println("任务信息: " + batchInfo);
                    System.err.println("\n请参考错误码文档: https://help.aliyun.com/zh/model-studio/developer-reference/error-code");
                    break;
                } else if ("expired".equals(status) || "cancelled".equals(status)) {
                    System.out.println("\n任务状态: " + status);
                    break;
                }
            }

        } catch (Exception e) {
            System.err.println("发生错误: " + e.getMessage());
            e.printStackTrace();
        }
    }

    /**
     * 上传文件
     */
    private static String uploadFile(String filePath) throws Exception {
        String boundary = "----WebKitFormBoundary" + System.currentTimeMillis();
        URL url = new URL(BASE_URL + "/files");
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setDoOutput(true);
        conn.setRequestMethod("POST");
        conn.setRequestProperty("Authorization", "Bearer " + API_KEY);
        conn.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);

        try (DataOutputStream out = new DataOutputStream(conn.getOutputStream())) {
            // 添加 purpose 字段
            out.writeBytes("--" + boundary + "\r\n");
            out.writeBytes("Content-Disposition: form-data; name=\"purpose\"\r\n\r\n");
            out.writeBytes("batch\r\n");

            // 添加文件
            out.writeBytes("--" + boundary + "\r\n");
            out.writeBytes("Content-Disposition: form-data; name=\"file\"; filename=\"" + filePath + "\"\r\n");
            out.writeBytes("Content-Type: application/octet-stream\r\n\r\n");

            byte[] fileBytes = Files.readAllBytes(Paths.get(filePath));
            out.write(fileBytes);
            out.writeBytes("\r\n");
            out.writeBytes("--" + boundary + "--\r\n");
        }

        String response = readResponse(conn);
        return parseField(response, "\"id\":\s*\"([^\"]+)\"");
    }

    /**
     * 创建 Batch 任务
     */
    private static String createBatch(String fileId) throws Exception {
        String jsonBody = String.format(
            "{\"input_file_id\":\"%s\",\"endpoint\":\"/v1/chat/ds-test\",\"completion_window\":\"24h\"}",
            fileId
        );

        String response = sendRequest("POST", "/batches", jsonBody);
        return parseField(response, "\"id\":\s*\"([^\"]+)\"");
    }

    /**
     * 获取 Batch 任务信息
     */
    private static String getBatch(String batchId) throws Exception {
        return sendRequest("GET", "/batches/" + batchId, null);
    }

    /**
     * 获取文件内容
     */
    private static String getFileContent(String fileId) throws Exception {
        return sendRequest("GET", "/files/" + fileId + "/content", null);
    }

    /**
     * 发送 HTTP 请求
     */
    private static String sendRequest(String method, String path, String jsonBody) throws Exception {
        URL url = new URL(BASE_URL + path);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod(method);
        conn.setRequestProperty("Authorization", "Bearer " + API_KEY);

        if (jsonBody != null) {
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json");
            try (OutputStream os = conn.getOutputStream()) {
                os.write(jsonBody.getBytes("UTF-8"));
            }
        }

        return readResponse(conn);
    }

    /**
     * 读取响应
     */
    private static String readResponse(HttpURLConnection conn) throws Exception {
        int responseCode = conn.getResponseCode();
        InputStream is = (responseCode < 400) ? conn.getInputStream() : conn.getErrorStream();

        try (Scanner scanner = new Scanner(is, "UTF-8").useDelimiter("\\A")) {
            return scanner.hasNext() ? scanner.next() : "";
        }
    }

    /**
     * 解析 JSON 字段（简单实现）
     */
    private static String parseField(String json, String regex) {
        java.util.regex.Pattern pattern = java.util.regex.Pattern.compile(regex);
        java.util.regex.Matcher matcher = pattern.matcher(json);
        return matcher.find() ? matcher.group(1) : null;
    }

    private static String parseStatus(String json) {
        return parseField(json, "\"status\":\s*\"([^\"]+)\"");
    }

    private static String parseOutputFileId(String json) {
        return parseField(json, "\"output_file_id\":\s*\"([^\"]+)\"");
    }

    private static String parseErrorFileId(String json) {
        return parseField(json, "\"error_file_id\":\s*\"([^\"]+)\"");
    }

    /**
     * 判断是否为终止状态
     */
    private static boolean isTerminalStatus(String status) {
        return "completed".equals(status)
            || "failed".equals(status)
            || "expired".equals(status)
            || "cancelled".equals(status);
    }
}
```

## curl (HTTP)

```bash
#!/bin/bash
# 阿里云百炼 Batch API 测试 - 使用 curl
#
# 前置条件：
# 1. 确保已经设置环境变量 DASHSCOPE_API_KEY
# 2. 准备好测试文件 test_model.jsonl（在当前目录）
#
# 地域配置说明：
# - 北京地域：https://dashscope.aliyuncs.com/compatible-mode/v1
# - 新加坡地域：https://dashscope-intl.aliyuncs.com/compatible-mode/v1

API_KEY="${DASHSCOPE_API_KEY}"
BASE_URL="https://dashscope.aliyuncs.com/compatible-mode/v1"

# 如果使用新加坡地域，请将 BASE_URL 替换为：
# BASE_URL="https://dashscope-intl.aliyuncs.com/compatible-mode/v1"

# 检查 API Key
if [ -z "$API_KEY" ]; then
    echo "错误: 请设置环境变量 DASHSCOPE_API_KEY"
    exit 1
fi

echo "=== 开始 Batch API 测试 ==="
echo ""

# Step 1: 上传文件
echo "步骤 1: 上传包含请求信息的 JSONL 文件..."
UPLOAD_RESPONSE=$(curl -s -X POST "${BASE_URL}/files" \
  -H "Authorization: Bearer ${API_KEY}" \
  -F 'file=@test_model.jsonl' \
  -F 'purpose=batch')

FILE_ID=$(echo $UPLOAD_RESPONSE | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "✓ 文件上传成功，文件ID: ${FILE_ID}"
echo ""

# Step 2: 创建 Batch 任务
echo "步骤 2: 创建 Batch 任务..."
BATCH_RESPONSE=$(curl -s -X POST "${BASE_URL}/batches" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"input_file_id\":\"${FILE_ID}\",\"endpoint\":\"/v1/chat/ds-test\",\"completion_window\":\"24h\"}")

BATCH_ID=$(echo $BATCH_RESPONSE | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "✓ Batch 任务创建成功，任务ID: ${BATCH_ID}"
echo ""

# Step 3: 轮询任务状态
echo "步骤 3: 等待任务完成..."
STATUS=""
POLL_COUNT=0

while [[ "$STATUS" != "completed" && "$STATUS" != "failed" && "$STATUS" != "expired" && "$STATUS" != "cancelled" ]]; do
    sleep 10
    BATCH_INFO=$(curl -s -X GET "${BASE_URL}/batches/${BATCH_ID}" \
      -H "Authorization: Bearer ${API_KEY}")
    STATUS=$(echo $BATCH_INFO | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
    POLL_COUNT=$((POLL_COUNT + 1))
    echo "  [${POLL_COUNT}] 任务状态: ${STATUS}"
done

echo ""
echo "✓ 任务已完成，最终状态: ${STATUS}"
echo ""

# Step 4: 下载结果
if [[ "$STATUS" == "completed" ]]; then
    echo "步骤 4: 下载结果文件..."

    OUTPUT_FILE_ID=$(echo $BATCH_INFO | grep -o '"output_file_id":"[^"]*"' | cut -d'"' -f4)
    if [[ -n "$OUTPUT_FILE_ID" && "$OUTPUT_FILE_ID" != "null" ]]; then
        echo "  输出文件ID: ${OUTPUT_FILE_ID}"

        RESULT_CONTENT=$(curl -s -X GET "${BASE_URL}/files/${OUTPUT_FILE_ID}/content" \
          -H "Authorization: Bearer ${API_KEY}")

        echo ""
        echo "--- 成功结果（前 500 字符）---"
        echo "${RESULT_CONTENT:0:500}"
        echo "..."
        echo ""
    fi

    ERROR_FILE_ID=$(echo $BATCH_INFO | grep -o '"error_file_id":"[^"]*"' | cut -d'"' -f4)
    if [[ -n "$ERROR_FILE_ID" && "$ERROR_FILE_ID" != "null" ]]; then
        echo "  错误文件ID: ${ERROR_FILE_ID}"

        ERROR_CONTENT=$(curl -s -X GET "${BASE_URL}/files/${ERROR_FILE_ID}/content" \
          -H "Authorization: Bearer ${API_KEY}")

        echo ""
        echo "--- 错误信息 ---"
        echo "${ERROR_CONTENT}"
    fi

    echo ""
    echo "=== 测试成功完成 ==="
elif [[ "$STATUS" == "failed" ]]; then
    echo ""
    echo "✗ Batch 任务失败"
    echo "任务信息: ${BATCH_INFO}"
    echo ""
    echo "请参考错误码文档: https://help.aliyun.com/zh/model-studio/developer-reference/error-code"
else
    echo ""
    echo "任务状态: ${STATUS}"
fi
```

### **第 3 步： 验证测试结果**

任务成功完成后，结果文件`result.jsonl`会包含固定响应`{"content":"This is a test result."}`：

```json
{"id":"a2b1ae25-21f4-4d9a-8634-99a29926486c","custom_id":"1","response":{"status_code":200,"request_id":"a2b1ae25-21f4-4d9a-8634-99a29926486c","body":{"created":1743562621,"usage":{"completion_tokens":6,"prompt_tokens":20,"total_tokens":26},"model":"batch-test-model","id":"chatcmpl-bca7295b-67c3-4b1f-8239-d78323bb669f","choices":[{"finish_reason":"stop","index":0,"message":{"content":"This is a test result."}}],"object":"chat.completion"}},"error":null}
{"id":"39b74f09-a902-434f-b9ea-2aaaeebc59e0","custom_id":"2","response":{"status_code":200,"request_id":"39b74f09-a902-434f-b9ea-2aaaeebc59e0","body":{"created":1743562621,"usage":{"completion_tokens":6,"prompt_tokens":20,"total_tokens":26},"model":"batch-test-model","id":"chatcmpl-1e32a8ba-2b69-4dc4-be42-e2897eac9e84","choices":[{"finish_reason":"stop","index":0,"message":{"content":"This is a test result."}}],"object":"chat.completion"}},"error":null}
```

## **执行正式任务**

### **输入文件要求**

示例文件[test.jsonl](https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20251119/mssigl/test.jsonl)内容：

```json
{"custom_id":"1","method":"POST","url":"/v1/chat/completions","body":{"model":"qwen-plus","messages":[{"role":"system","content":"You are a helpful assistant."},{"role":"user","content":"你好！有什么可以帮助你的吗？"}]}}
{"custom_id":"2","method":"POST","url":"/v1/chat/completions","body":{"model":"qwen-plus","messages":[{"role":"system","content":"You are a helpful assistant."},{"role":"user","content":"What is 2+2?"}]}}
```

**JSONL 批量生成工具**

使用以下工具可快速生成 JSONL 文件。

 JSONL 批量生成工具

### **1\. 修改输入文件**

+   可直接修改用于测试的 `test_model.jsonl` 文件，将 model 参数设置为需要使用的正式模型，并设置 url 字段：
    
    <table id="73a66640d9mn5" outputclass="table-wide" tablewidth="514" tablecolswidth="261 253" autofit="false" class="table-wide table"><colgroup colwidth="1.02*"></colgroup><colgroup colwidth="0.98*"></colgroup><tbody class="tbody"><tr id="4607b9a8cbso3"><td id="8a6dedc1d9o2y" rowspan="1" colspan="1"><p jc="left" id="c6abc5eb71e0s"><b>模型类型</b></p></td><td id="3aa59a58d9ij4" rowspan="1" colspan="1"><p jc="left" id="c7d448ac40vp5"><b>url</b></p></td></tr><tr id="c5b9e9056518f"><td id="b60df14232o1r" rowspan="1" colspan="1"><p jc="left" id="064ae2c50djml">文本生成/多模态模型</p></td><td id="bac8531ee0msq" rowspan="1" colspan="1"><p jc="left" id="1cda436d1dd00"><code data-tag="code" class="code blog-code" id="e3e9b4711byhw">/v1/chat/completions</code></p></td></tr><tr id="8af931ba473mq"><td id="06c91f4029s25" rowspan="1" colspan="1"><p jc="left" id="1d1e708128sl1">文本向量模型</p></td><td id="2be112acebduu" rowspan="1" colspan="1"><p jc="left" id="bd47e666d0dca"><code data-tag="code" class="code blog-code" id="d356a595f5vhn">/v1/embeddings</code></p></td></tr></tbody></table>
    
+   或使用上方的“JSONL 批量生成工具”为正式任务生成一个新的文件。关键是确保 `model` 和 `url` 字段正确。
    

### **2\. 修改快速开始的代码**

1.  输入文件路径更改为您的文件名
    
2.  将 endpoint 参数值修改为与输入文件中 url 字段一致的值
    

### **3\. 运行代码并等待结果**

任务成功后，成功的请求结果将保存在本地的 result.jsonl 文件中。如果部分请求失败，错误详情将保存在 error.jsonl 文件中。

+   成功结果（`output_file_id`）：每一行对应一个成功的原始请求，包含 `custom_id` 和 `response`。
    
    ```json
    {"id":"3a5c39d5-3981-4e4c-97f2-e0e821893f03","custom_id":"req-001","response":{"status_code":200,"request_id":"3a5c39d5-3981-4e4c-97f2-e0e821893f03","body":{"created":1768306034,"usage":{"completion_tokens":654,"prompt_tokens":14,"total_tokens":668},"model":"qwen-plus","id":"chatcmpl-3a5c39d5-3981-4e4c-97f2-e0e821893f03","choices":[{"finish_reason":"stop","index":0,"message":{"role":"assistant","content":"你好！杭州西湖是中国著名的风景名胜区，位于浙江省杭州市西部，因此得名“西湖”。它是中国十大风景名胜之一，也是世界文化遗产（2011年被联合国教科文组织列入《世界遗产名录》），以其秀丽的自然风光与深厚的人文底蕴闻名于世。\n\n### 一、自然景观\n西湖三面环山，一面邻城，湖面面积约6.39平方公里，形似如意，碧波荡漾。湖中被孤山、白堤、苏堤、杨公堤等自然或人工分隔成多个水域，形成“一山二塔三岛三堤”的格局。\n\n主要景点包括：\n- **苏堤春晓**：北宋大文豪苏东坡任杭州知州时主持疏浚西湖，用挖出的淤泥堆筑成堤，后人称为“苏堤”。春天桃红柳绿，景色如画。\n- **断桥残雪**：位于白堤东端，是白蛇传中“断桥相会”的发生地，冬日雪后银装素裹，尤为著名。\n- **雷峰夕照**：雷峰塔在夕阳映照下金光熠熠，曾是“西湖十景”之一。\n- **三潭印月**：湖中小瀛洲上的三座石塔，中秋夜可在塔内点灯，月影、灯光、湖光交相辉映。\n- **平湖秋月**：位于白堤西端，是观赏湖上明月的绝佳地点。\n- **花港观鱼**：以赏花和观鱼著称，园内牡丹、锦鲤相映成趣。\n\n### 二、人文历史\n西湖不仅风景优美，还承载着丰富的历史文化：\n- 自唐宋以来，众多文人墨客如白居易、苏东坡、林逋、杨万里等在此留下诗篇。\n- 白居易曾主持修建“白堤”，疏浚西湖，造福百姓。\n- 西湖周边有众多古迹，如岳王庙（纪念民族英雄岳飞）、灵隐寺（千年古刹）、六和塔、龙井村（中国十大名茶龙井茶的产地）等。\n\n### 三、文化象征\n西湖被誉为“人间天堂”的代表，是中国传统山水美学的典范。它融合了自然美与人文美，体现了“天人合一”的哲学思想。许多诗词、绘画、戏曲都以西湖为题材，成为中国文化的重要符号。\n\n### 四、旅游建议\n- 最佳游览季节：春季（3-5月）桃红柳绿，秋季（9-11月）天高气爽。\n- 推荐方式：步行、骑行（环湖绿道）、乘船游湖。\n- 周边美食：西湖醋鱼、龙井虾仁、东坡肉、片儿川等。\n\n总之，杭州西湖不仅是一处自然美景，更是一座活着的文化博物馆，值得细细品味。如果你有机会到杭州，一定不要错过这个“淡妆浓抹总相宜”的人间仙境。"}}],"object":"chat.completion"}},"error":null}
    {"id":"628312ba-172c-457d-ba7f-3e5462cc6899","custom_id":"req-002","response":{"status_code":200,"request_id":"628312ba-172c-457d-ba7f-3e5462cc6899","body":{"created":1768306035,"usage":{"completion_tokens":25,"prompt_tokens":18,"total_tokens":43},"model":"qwen-plus","id":"chatcmpl-628312ba-172c-457d-ba7f-3e5462cc6899","choices":[{"finish_reason":"stop","index":0,"message":{"role":"assistant","content":"春风拂柳绿，  \n夜雨润花红。  \n鸟语林间闹，  \n山川处处同。"}}],"object":"chat.completion"}},"error":null}
    ```
    
+   失败详情（`error_file_id`）：包含处理失败的请求行信息和错误原因，可参考[错误码](#97e145aeabbwf)进行排查。
    

## **具体流程**

Batch API 的使用流程分为四个步骤：上传文件、创建任务、查询任务状态、下载结果。

### **1\. 上传文件**

创建Batch任务前，将符合输入文件格式要求的JSONL文件通过文件上传接口上传，获取`file_id`。

> 上传文件，`purpose`必须是`batch`。

## OpenAI Python SDK

#### 请求示例

```python
import os
from pathlib import Path
from openai import OpenAI

client = OpenAI(
    # 若没有配置环境变量，可用阿里云百炼API Key将下行替换为：api_key="sk-xxx"。但不建议在生产环境中直接将API Key硬编码到代码中，以减少API Key泄露风险。
    # 新加坡和北京地域的API Key不同。
    api_key=os.getenv("DASHSCOPE_API_KEY"),
    # 以下是北京地域base_url，如果使用新加坡地域的模型，需要将base_url替换为：https://dashscope-intl.aliyuncs.com/compatible-mode/v1
    # 注意：切换地域时，API Key也需要对应更换
    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
)

# test.jsonl 是一个本地示例文件，purpose必须是batch
file_object = client.files.create(file=Path("test.jsonl"), purpose="batch")

print(file_object.model_dump_json())
```

## OpenAI Node.js SDK

#### 请求示例

```javascript
/**
 * 阿里云百炼 Batch API - 上传文件
 * 
 * 若没有配置环境变量，可在代码中硬编码API Key：apiKey: 'sk-xxx'
 * 但不建议在生产环境中直接将API Key硬编码到代码中，以减少API Key泄露风险。
 * 新加坡和北京地域的API Key不同。
 * 
 * 安装依赖：npm install openai
 */
const OpenAI = require('openai');
const fs = require('fs');

// 北京地域配置（默认）
const BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
// 如果使用新加坡地域，请将上面的 BASE_URL 替换为：
// const BASE_URL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
// 注意：切换地域时，API Key也需要对应更换

const apiKey = process.env.DASHSCOPE_API_KEY;
if (!apiKey) {
    console.error('错误: 请设置环境变量 DASHSCOPE_API_KEY');
    console.error('或在代码中设置: const apiKey = "sk-xxx";');
    process.exit(1);
}

const client = new OpenAI({
    apiKey: apiKey,
    baseURL: BASE_URL
});

const fileStream = fs.createReadStream('test.jsonl');
const fileObject = await client.files.create({
    file: fileStream,
    purpose: 'batch'
});
console.log(fileObject.id);
```

## Java（HTTP）

#### 请求示例

```java
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.Scanner;
import java.util.regex.Pattern;
import java.util.regex.Matcher;

/**
 * 阿里云百炼 Batch API - 上传文件
 * 
 * 若没有配置环境变量，可在代码中硬编码API Key：API_KEY = "sk-xxx"
 * 但不建议在生产环境中直接将API Key硬编码到代码中，以减少API Key泄露风险。
 * 新加坡和北京地域的API Key不同。
 * 
 * 地域配置：
 * - 北京地域：https://dashscope.aliyuncs.com/compatible-mode/v1
 * - 新加坡地域：https://dashscope-intl.aliyuncs.com/compatible-mode/v1
 * 注意：切换地域时，API Key也需要对应更换
 */
public class BatchAPIUploadFile {
    
    // 北京地域配置（默认）
    private static final String BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
    // 如果使用新加坡地域，请将上面的 BASE_URL 替换为：
    // private static final String BASE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
    // 注意：切换地域时，API Key也需要对应更换
    
    private static String API_KEY;
    
    public static void main(String[] args) throws Exception {
        API_KEY = System.getenv("DASHSCOPE_API_KEY");
        if (API_KEY == null || API_KEY.isEmpty()) {
            System.err.println("错误: 请设置环境变量 DASHSCOPE_API_KEY");
            System.err.println("或在代码中设置: API_KEY = \"sk-xxx\";");
            System.exit(1);
        }
        
String fileId = uploadFile("test.jsonl");
        System.out.println("文件ID: " + fileId);
    }
    
    // === 工具方法 ===
    
    private static String uploadFile(String filePath) throws Exception {
        String boundary = "----WebKitFormBoundary" + System.currentTimeMillis();
        URL url = new URL(BASE_URL + "/files");
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setDoOutput(true);
        conn.setRequestMethod("POST");
        conn.setRequestProperty("Authorization", "Bearer " + API_KEY);
        conn.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);

        try (DataOutputStream out = new DataOutputStream(conn.getOutputStream())) {
            // 添加 purpose 字段
            out.writeBytes("--" + boundary + "\r\n");
            out.writeBytes("Content-Disposition: form-data; name=\"purpose\"\r\n\r\n");
            out.writeBytes("batch\r\n");

            // 添加文件
            out.writeBytes("--" + boundary + "\r\n");
            out.writeBytes("Content-Disposition: form-data; name=\"file\"; filename=\"" + filePath + "\"\r\n");
            out.writeBytes("Content-Type: application/octet-stream\r\n\r\n");

            byte[] fileBytes = Files.readAllBytes(Paths.get(filePath));
            out.write(fileBytes);
            out.writeBytes("\r\n");
            out.writeBytes("--" + boundary + "--\r\n");
        }

        String response = readResponse(conn);
        return parseField(response, "\"id\":\\s*\"([^\"]+)\"");
    }
    
    private static String readResponse(HttpURLConnection conn) throws Exception {
        int responseCode = conn.getResponseCode();
        InputStream is = (responseCode < 400) ? conn.getInputStream() : conn.getErrorStream();
        try (Scanner scanner = new Scanner(is, "UTF-8").useDelimiter("\\A")) {
            return scanner.hasNext() ? scanner.next() : "";
        }
    }
    
    private static String parseField(String json, String regex) {
        Pattern pattern = Pattern.compile(regex);
        Matcher matcher = pattern.matcher(json);
        return matcher.find() ? matcher.group(1) : null;
    }
}
```

## curl(HTTP)

#### 请求示例

```curl
# ======= 重要提示 =======
# 新加坡和北京地域的API Key不同。
# 以下是北京地域base_url，如果使用新加坡地域的模型，需要将base_url替换为：https://dashscope-intl.aliyuncs.com/compatible-mode/v1/files
# === 执行时请删除该注释 ===
curl -X POST https://dashscope.aliyuncs.com/compatible-mode/v1/files \
-H "Authorization: Bearer $DASHSCOPE_API_KEY" \
--form 'file=@"test.jsonl"' \
--form 'purpose="batch"'
```

#### 返回示例

```json
{
    "id": "file-batch-xxx",
    "bytes": 437,
    "created_at": 1742304153,
    "filename": "test.jsonl",
    "object": "file",
    "purpose": "batch",
    "status": "processed",
    "status_details": null
}
```

### **2\. 创建 Batch 任务**

使用上传文件返回的文件 id或 OSS 路径 创建 Batch 任务。

## OpenAI Python SDK

#### 请求示例

```python
import os
from openai import OpenAI

client = OpenAI(
    # 若没有配置环境变量，可用阿里云百炼API Key将下行替换为：api_key="sk-xxx"。但不建议在生产环境中直接将API Key硬编码到代码中，以减少API Key泄露风险。
    # 新加坡和北京地域的API Key不同。
    api_key=os.getenv("DASHSCOPE_API_KEY"),
    # 以下是北京地域base_url，如果使用新加坡地域的模型，需要将base_url替换为：https://dashscope-intl.aliyuncs.com/compatible-mode/v1
    # 注意：切换地域时，API Key也需要对应更换
    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
)

batch = client.batches.create(
    input_file_id="file-batch-xxx",  # 上传文件返回的id或OSS文件URL或OSS文件资源标识符
    endpoint="/v1/chat/completions",  # 测试模型batch-test-model填写/v1/chat/ds-test，文本向量模型填写/v1/embeddings，文本生成/多模态模型填写/v1/chat/completions
    completion_window="24h",
    metadata={'ds_name':"任务名称",'ds_description':'任务描述'} # metadata数据，非必填字段，用于创建任务名称、描述
)
print(batch)
```

## OpenAI Node.js SDK

#### 请求示例

```javascript
/**
 * 阿里云百炼 Batch API - 创建Batch任务
 * 
 * 若没有配置环境变量，可在代码中硬编码API Key：apiKey: 'sk-xxx'
 * 但不建议在生产环境中直接将API Key硬编码到代码中，以减少API Key泄露风险。
 * 新加坡和北京地域的API Key不同。
 * 
 * 安装依赖：npm install openai
 */
const OpenAI = require('openai');

// 北京地域配置（默认）
const BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
// 如果使用新加坡地域，请将上面的 BASE_URL 替换为：
// const BASE_URL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
// 注意：切换地域时，API Key也需要对应更换

const apiKey = process.env.DASHSCOPE_API_KEY;
if (!apiKey) {
    console.error('错误: 请设置环境变量 DASHSCOPE_API_KEY');
    console.error('或在代码中设置: const apiKey = "sk-xxx";');
    process.exit(1);
}

const client = new OpenAI({
    apiKey: apiKey,
    baseURL: BASE_URL
});

const batch = await client.batches.create({
    input_file_id: 'file-batch-xxx',
    endpoint: '/v1/chat/completions',
    completion_window: '24h',
    metadata: {'ds_name': '任务名称', 'ds_description': '任务描述'}
});
console.log(batch.id);
```

## Java（HTTP）

#### 请求示例

```java
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Scanner;
import java.util.regex.Pattern;
import java.util.regex.Matcher;

/**
 * 阿里云百炼 Batch API - 创建Batch任务
 * 
 * 若没有配置环境变量，可在代码中硬编码API Key：API_KEY = "sk-xxx"
 * 但不建议在生产环境中直接将API Key硬编码到代码中，以减少API Key泄露风险。
 * 新加坡和北京地域的API Key不同。
 * 
 * 地域配置：
 * - 北京地域：https://dashscope.aliyuncs.com/compatible-mode/v1
 * - 新加坡地域：https://dashscope-intl.aliyuncs.com/compatible-mode/v1
 * 注意：切换地域时，API Key也需要对应更换
 */
public class BatchAPICreateBatch {
    
    // 北京地域配置（默认）
    private static final String BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
    // 如果使用新加坡地域，请将上面的 BASE_URL 替换为：
    // private static final String BASE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
    // 注意：切换地域时，API Key也需要对应更换
    
    private static String API_KEY;
    
    public static void main(String[] args) throws Exception {
        API_KEY = System.getenv("DASHSCOPE_API_KEY");
        if (API_KEY == null || API_KEY.isEmpty()) {
            System.err.println("错误: 请设置环境变量 DASHSCOPE_API_KEY");
            System.err.println("或在代码中设置: API_KEY = \"sk-xxx\";");
            System.exit(1);
        }
        
        String jsonBody = "{\"input_file_id\":\"file-batch-xxx\",\"endpoint\":\"/v1/chat/completions\",\"completion_window\":\"24h\",\"metadata\":{\"ds_name\":\"任务名称\",\"ds_description\":\"任务描述\"}}";
String response = sendRequest("POST", "/batches", jsonBody);
        String batchId = parseField(response, "\"id\":\\s*\"([^\"]+)\"");
        System.out.println("Batch任务ID: " + batchId);
    }
    
    // === 工具方法 ===
    
    private static String sendRequest(String method, String path, String jsonBody) throws Exception {
        URL url = new URL(BASE_URL + path);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod(method);
        conn.setRequestProperty("Authorization", "Bearer " + API_KEY);
        
        if (jsonBody != null) {
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json");
            try (OutputStream os = conn.getOutputStream()) {
                os.write(jsonBody.getBytes("UTF-8"));
            }
        }
        
        return readResponse(conn);
    }
    
    private static String readResponse(HttpURLConnection conn) throws Exception {
        int responseCode = conn.getResponseCode();
        InputStream is = (responseCode < 400) ? conn.getInputStream() : conn.getErrorStream();
        try (Scanner scanner = new Scanner(is, "UTF-8").useDelimiter("\\A")) {
            return scanner.hasNext() ? scanner.next() : "";
        }
    }
    
    private static String parseField(String json, String regex) {
        Pattern pattern = Pattern.compile(regex);
        Matcher matcher = pattern.matcher(json);
        return matcher.find() ? matcher.group(1) : null;
    }
}
```

## curl（HTTP）

#### 请求示例

```curl
# ======= 重要提示 =======
# 新加坡和北京地域的API Key不同。
# 以下是北京地域base_url，如果使用新加坡地域的模型，需要将base_url替换为：https://dashscope-intl.aliyuncs.com/compatible-mode/v1/batches
# === 执行时请删除该注释 ===
curl -X POST https://dashscope.aliyuncs.com/compatible-mode/v1/batches \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input_file_id": "file-batch-xxx",
    "endpoint": "/v1/chat/completions",
    "completion_window": "24h",
    "metadata":{"ds_name":"任务名称","ds_description":"任务描述"}
  }'
```

#### **输入参数**

<table id="faaec6450eyqe" tablewidth="100" tablecolswidth="24.35 13.04 12.03 9.86 40.72" autofit="true" class="table"><colgroup colwidth="1.22*"></colgroup><colgroup colwidth="0.65*"></colgroup><colgroup colwidth="0.6*"></colgroup><colgroup colwidth="0.49*"></colgroup><colgroup colwidth="2.04*"></colgroup><tbody class="tbody"><tr id="5a16ca9580kg2"><td id="bc83f62153okf" rowspan="1" colspan="1"><p jc="left" uuid="lzb034d945syqpebmf5" id="2c1cb176e5l9k"><b>字段</b></p></td><td id="102910506eylf" rowspan="1" colspan="1"><p jc="left" uuid="lzb034d98ha6ubbi30u" id="691eab9bb2elh"><b>类型</b></p></td><td id="48418700a24z0" rowspan="1" colspan="1"><p jc="left" uuid="lzb034d9jne91l1khxd" id="7c2d3ac8f7e2r"><b>传参</b></p><p jc="left" uuid="mk6pbvzlu4in1v2sb4k" id="3ae5942345mmg"><b>方式</b></p></td><td id="9a37c84220hgf" rowspan="1" colspan="1"><p jc="left" uuid="lzb034d9od75l9rjlcl" id="a93624d8e1oz4"><b>必选</b></p></td><td id="b08f00ab9b4rd" rowspan="1" colspan="1"><p jc="left" uuid="lzb034d9nooojmxk2q" id="9258a42855ezg"><b>描述</b></p></td></tr><tr id="6db8bf2c9bq6y"><td id="7bd3a8b98fl3p" rowspan="1" colspan="1"><p jc="left" uuid="lzb034da678qfery9tf" id="9af9f0f17fj8x">input_file_id</p></td><td id="cff2f1e065pbu" rowspan="1" colspan="1"><p jc="left" uuid="lzb034da47tjpz7udq4" id="673df59d72ayn">String</p></td><td id="ae29616755cjw" rowspan="1" colspan="1"><p jc="left" uuid="lzb034dapb0hdr7pm48" id="1f1125a20f5zr">Body</p></td><td id="4b432824dfiax" rowspan="1" colspan="1"><p jc="left" uuid="lzb034daahe81lsahwl" id="bb42108162sf8">是</p></td><td id="4edffe70e7gqa" rowspan="1" colspan="1"><section id="88aa57aa4b8k4" props="china" data-cond-props="china" class="section"><p jc="left" id="5cb45b6664hg5">用于指定文件<span class="help-letter-space"></span>ID、OSS<span class="help-letter-space"></span>文件<span class="help-letter-space"></span>URL<span class="help-letter-space"></span>或<span class="help-letter-space"></span>OSS<span class="help-letter-space"></span>文件资源标识符，作为<span class="help-letter-space"></span>Batch<span class="help-letter-space"></span>任务的输入文件。您可以通过以下任一方式提供此参数：</p><ul id="6025082e00ynx"><li id="be3cb34c9ey4f"><p jc="left" id="0b67cd3de46bj"><a href="#a6e2ba320a8nt" id="58715dbb226o5" title="" class="xref">准备与上传文件</a>接口返回的文件<span class="help-letter-space"></span>ID，如<code data-tag="code" id="46b2681aafble" class="code">file-batch-xxx</code>；</p></li><li id="28bac40bdf3qu"><p jc="left" id="d06259b8eb6pn"><a href="#f667257850olj" id="9a766a3d6fhye" title="" class="xref">使用 OSS 文件创建 Batch 任务</a>。</p></li></ul></section></td></tr><tr id="d2c996d2c2x8c"><td id="45da75de5cs2a" rowspan="1" colspan="1"><p jc="left" uuid="lzb034daw9qzh331wv" id="ed469dce84y91">endpoint</p></td><td id="15b8dc8d05csv" rowspan="1" colspan="1"><p jc="left" uuid="lzb034dahr0lp8antz" id="1d6ed1ba9bjyh">String</p></td><td id="9b2debb330hen" rowspan="1" colspan="1"><p jc="left" uuid="lzb034dap5y4beencg8" id="d14f3b8c47863">Body</p></td><td id="31f669323b0l7" rowspan="1" colspan="1"><p jc="left" uuid="lzb034dax6c4eflj6k" id="c0c71230cc0vc">是</p></td><td id="13b99913e4jc3" rowspan="1" colspan="1"><p jc="left" uuid="lzb034dayx414thgbk" id="abf032b39f42e">访问路径，需和输入文件中的<span class="help-letter-space"></span>url<span class="help-letter-space"></span>字段保持一致。</p><ul id="7da8a72bf5y6n"><li id="65590794520wa" props="china" data-cond-props="china"><p jc="left" id="0b4d21725897k">Embedding<span class="help-letter-space"></span>文本向量模型填写<code data-tag="code" id="b3e240472b9ny" class="code">/v1/embeddings</code></p></li><li id="5c0880979ddia"><p jc="left" id="52cfd8416cr98">测试模型<code data-tag="code" id="062b68d0faknx" class="code">batch-test-model</code>填写<code data-tag="code" id="463d718b3egpz" class="code">/v1/chat/ds-test</code></p></li><li id="ef79d10065sat"><p jc="left" id="b2bba0bf6c25c">其他模型填写<code data-tag="code" id="45f5d2590brld" class="code">/v1/chat/completions</code></p></li></ul></td></tr><tr id="e60a390eeb6x3"><td id="961d0b0765l3e" rowspan="1" colspan="1"><p jc="left" uuid="lzb0huw4f1va8lrh27j" id="993a5a2772rmg">completion_window</p></td><td id="27660b6928118" rowspan="1" colspan="1"><p jc="left" uuid="lzb0huw4aut8xvl4lir" id="90c8a21ea3bni">String</p></td><td id="902289f8d05bd" rowspan="1" colspan="1"><p jc="left" uuid="lzb0huw4keep0awap8" id="31fad7c26fv0j">Body</p></td><td id="e4f92e59f1uaf" rowspan="1" colspan="1"><p jc="left" uuid="lzb0huw4dyaph6t9tv" id="c57a6c47a5o12">是</p></td><td id="705ce233594df" rowspan="1" colspan="1"><p jc="left" uuid="lzb0huw4portowwyqro" id="162f97cb1fpf5">等待时间，支持最短等待时间<span class="help-letter-space"></span>24h，最长等待时间<span class="help-letter-space"></span>336h，仅支持整数。</p><p jc="left" uuid="m667b43jsjhzv8zwta8" id="90615b7976i6a">支持"h"和"d"两个单位，如"24h"或"14d"。</p></td></tr><tr id="4dad634cb3jnf"><td id="0ff67fc3cf7vj" rowspan="1" colspan="1"><p jc="left" uuid="lzb0huw2zcp9vmwrahf" id="04f9903933heu">metadata</p></td><td id="8fc18b1945b4m" rowspan="1" colspan="1"><p jc="left" uuid="lzb0huw2tt5lkuf2ts" id="b8432e3bf2sg3">Map</p></td><td id="cdd234b44d6or" rowspan="1" colspan="1"><p jc="left" uuid="lzb0huw298j1es1da1t" id="ca2ba14503l01">Body</p></td><td id="a36e246b3182j" rowspan="1" colspan="1"><p jc="left" uuid="lzb0huw2u9d7u3sdb1k" id="da8d84b134dig">否</p></td><td id="eeb0798715aqw" rowspan="1" colspan="1"><p jc="left" uuid="m8gs9k1nu82icf08plg" id="bf8f51f028cvk">任务扩展元数据，以键值对形式附加信息。</p></td></tr><tr id="aef5537b83kj1"><td id="a223b89214hqk" rowspan="1" colspan="1"><p jc="left" id="462d59fcaayr3">metadata.ds_name</p></td><td id="f26f053b5arfd" rowspan="1" colspan="1"><p jc="left" id="be0ea119fd3ph">String</p></td><td id="96b53190c4yer" rowspan="1" colspan="1"><p jc="left" id="58e666511bx0q">Body</p></td><td id="d53c5dd12d34o" rowspan="1" colspan="1"><p jc="left" id="a5348b6e26l2o">否</p></td><td id="e7fd2d6c4c1ka" rowspan="1" colspan="1"><p jc="left" id="cab51f6461l64">任务名称。</p><p jc="left" id="6e3dae83bb0k8">示例：<code data-tag="code" id="972f190b73pwn" class="code">"ds_name"："Batch<span class="help-letter-space"></span>任务"</code></p><p jc="left" id="7f3587d9bcm3h">限制：长度不超过<span class="help-letter-space"></span>100<span class="help-letter-space"></span>个字符。</p><p jc="left" id="7cba02912e6vq">若重复定义该字段，以最后一次传入的值为准。</p></td></tr><tr id="5b8517a471l5v"><td id="1a426c82f2gro" rowspan="1" colspan="1"><p jc="left" id="2d50364efcx2k">metadata.ds_description</p></td><td id="63b410536bok5" rowspan="1" colspan="1"><p jc="left" id="e8edfda2f64du">String</p></td><td id="c659e2312bo41" rowspan="1" colspan="1"><p jc="left" id="2f7954e8c4brc">Body</p></td><td id="00fd1e1eeaz82" rowspan="1" colspan="1"><p jc="left" id="1a6fd7c97cnb0">否</p></td><td id="c860f90ea9mhz" rowspan="1" colspan="1"><p jc="left" id="ea242dd600zgb">任务描述。</p><p jc="left" id="90d18698529i7">示例：<code data-tag="code" id="768a96a3a13sa" class="code">"ds_description"："Batch<span class="help-letter-space"></span>推理任务测试"</code></p><p jc="left" id="abab4b8b6bsuh">限制：长度不超过<span class="help-letter-space"></span>200<span class="help-letter-space"></span>个字符。</p><p jc="left" id="b6af74c745sjr">若重复定义该字段，以最后一次传入的值为准。</p></td></tr></tbody></table>

#### 返回示例

```json
{
    "id": "batch_xxx",
    "object": "batch",
    "endpoint": "/v1/chat/completions",
    "errors": null,
    "input_file_id": "file-batch-xxx",
    "completion_window": "24h",
    "status": "validating",
    "output_file_id": null,
    "error_file_id": null,
    "created_at": 1742367779,
    "in_progress_at": null,
    "expires_at": null,
    "finalizing_at": null,
    "completed_at": null,
    "failed_at": null,
    "expired_at": null,
    "cancelling_at": null,
    "cancelled_at": null,
    "request_counts": {
        "total": 0,
        "completed": 0,
        "failed": 0
    },
    "metadata": {
        "ds_name": "任务名称",
        "ds_description": "任务描述"
    }
}
```

#### 返回参数

<table id="89415f5b7bfmu" tablewidth="604" tablecolswidth="183 86 335" autofit="false" class="table"><colgroup colwidth="0.91*"></colgroup><colgroup colwidth="0.43*"></colgroup><colgroup colwidth="1.67*"></colgroup><tbody class="tbody"><tr id="891d5c678dh2g"><td id="89b1487eb5y5y" rowspan="1" colspan="1"><p jc="left" uuid="lzb03ltzqcwwdnquaeb" id="6cbf127316oq4"><b>字段</b></p></td><td id="610880ae2ais5" rowspan="1" colspan="1"><p jc="left" uuid="lzb03ltz0qeoq3wstzso" id="b32b5becbf009"><b>类型</b></p></td><td id="a7a1691bf1zz7" rowspan="1" colspan="1"><p jc="left" uuid="lzb03ltzrn5w4uzfvv" id="fbb9a457ca167"><b>描述</b></p></td></tr><tr id="608c6e6a78fxd"><td id="f4fb5c31f1rbo" rowspan="1" colspan="1"><p jc="left" uuid="lwyeqppfjcjjvof0de" id="51e56c2426xst" left="0">id</p></td><td id="9a42992220nll" rowspan="1" colspan="1"><p jc="left" uuid="lwyeqppf5sc8rcpj92p" id="c02e309b64sbt" left="0">String</p></td><td id="356242ef7e71c" rowspan="1" colspan="1"><p jc="left" uuid="lwyeqppfinvyi51uf6k" id="1e8db96d36ju7" left="0">本次创建的<span class="help-letter-space"></span>Batch<span class="help-letter-space"></span>任务 ID。</p></td></tr><tr id="e0168e70b20st"><td id="dc21853422tkd" rowspan="1" colspan="1"><p jc="left" uuid="lwyfdu4ahw5kyfueqzf" id="36beecfc24wx1">object</p></td><td id="cd552e774348v" rowspan="1" colspan="1"><p jc="left" uuid="lwyfdu4bl1ooemkor1" id="92ade7eae4p2b">String</p></td><td id="a63047217b2vg" rowspan="1" colspan="1"><p jc="left" uuid="lwyfdu4chfudheom8t6" id="e16033ac1bger">对象类型，固定值<code data-tag="code" code-type="xCode" id="218032c598qdj" class="code">batch</code>。</p></td></tr><tr id="c51b4d87ffc45"><td id="c551228aadj47" rowspan="1" colspan="1"><p jc="left" uuid="lxcunjpmydcv6c96udq" id="6feb4c060cfhs">endpoint</p></td><td id="f8e653751cq2e" rowspan="1" colspan="1"><p jc="left" uuid="lxcunjpmh4rh3r1xn85" id="f3d5a97d36llc">String</p></td><td id="83a32f48b3h40" rowspan="1" colspan="1"><p jc="left" uuid="lxcunjpmrlmskri4jdl" id="5921ab3bcd8zf">访问路径。</p></td></tr><tr id="e05f528398uj6"><td id="45e0b40d4aqtq" rowspan="1" colspan="1"><p jc="left" uuid="lwyeqppfq2rygsdzdo" id="a88f2645ac5q8" left="0">errors</p></td><td id="eab7aba8fdfrf" rowspan="1" colspan="1"><p jc="left" uuid="lwyfgm4jdouk6pljcpi" id="f6c665dca3ool">Map</p></td><td id="3d90fb7405fk8" rowspan="1" colspan="1"><p jc="left" uuid="lwyfgm4mp4yr1hp0zvo" id="3af5a8a42bq9i">错误信息。</p></td></tr><tr id="8c8564b3a2fd6"><td id="d6b02bbe17cfr" rowspan="1" colspan="1"><p jc="left" uuid="lwyeqppf7r01oamb3mp" id="7ce8f51d38ivf" left="0">input_file_id</p></td><td id="1f5aef616fv23" rowspan="1" colspan="1"><p jc="left" uuid="lwyfgm4npy1ul0vfo" id="59ce4ff555d2o">String</p></td><td id="27e9574086h6k" rowspan="1" colspan="1"><p jc="left" uuid="lwyfgm4qsvgv8w9cqdi" id="fc457b0f7bvr9">文件<span class="help-letter-space"></span>ID<span class="help-letter-space"></span><span data-tag="ph" id="78bdb045f7v0h" props="china" data-cond-props="china" class="ph">或<span class="help-letter-space"></span>OSS<span class="help-letter-space"></span>文件 URL<span class="help-letter-space"></span>或<span class="help-letter-space"></span>OSS<span class="help-letter-space"></span>文件资源标识符</span>。</p></td></tr><tr id="8692ce8b325xv"><td id="b2be818e595o5" rowspan="1" colspan="1"><p jc="left" uuid="lwyeqppfcdyu1wabhz8" id="62f29876e6kc3" left="0">completion_window</p></td><td id="ff8a3f715dz2g" rowspan="1" colspan="1"><p jc="left" uuid="lwyfgm4vmg3s6y2pan" id="02324416b7n25">String</p></td><td id="6a85857566o94" rowspan="1" colspan="1"><p jc="left" uuid="lzb0huw4portowwyqro" id="a536f74291py2">等待时间，支持最短等待时间<span class="help-letter-space"></span>24h，最长等待时间<span class="help-letter-space"></span>336h，仅支持整数。</p><p jc="left" uuid="m667b43jsjhzv8zwta8" id="0a4fe69a096v2">支持"h"和"d"两个单位，如"24h"或"14d"。</p></td></tr><tr id="2805713005uqh"><td id="dd8553e043n50" rowspan="1" colspan="1"><p jc="left" uuid="lwyeqppf8em67aott77" id="f8a7d34066yos" left="0">status</p></td><td id="d1f39839610dl" rowspan="1" colspan="1"><p jc="left" uuid="lwyniz7wdkioftbjrav" id="6576823caa762">String</p></td><td id="7e9bd7c4aarl9" rowspan="1" colspan="1"><p jc="left" uuid="lwyfgm4z7eo13rmal6u" id="fb119e379c62v">任务状态，包括<span class="help-letter-space"></span>validating、failed、in_progress、finalizing、completed、expired、cancelling、cancelled。</p></td></tr><tr id="c56b2381f674o"><td id="42c13782afppl" rowspan="1" colspan="1"><p jc="left" uuid="lwyeqppf0ux6c98agsm" id="9f6b5ec5a5ed5" left="0">output_file_id</p></td><td id="5149920bb8oa6" rowspan="1" colspan="1"><p jc="left" uuid="lwyniz7xnqtljbmh8xh" id="191c01f90eobj">String</p></td><td id="760e2ae132pc9" rowspan="1" colspan="1"><p jc="left" uuid="lwyfgm511a9jk2mtjza" id="70b2caa46fyww">执行成功请求的输出文件<span class="help-letter-space"></span>id。</p></td></tr><tr id="a8f684cc5dg5u"><td id="8392d17abab9m" rowspan="1" colspan="1"><p jc="left" uuid="lwyfh6ra5wdp55i8exq" id="dc389a7d5blmw">error_file_id</p></td><td id="3c0a787cae7qm" rowspan="1" colspan="1"><p jc="left" uuid="lwyniz7zk8n2bwai92" id="f4edd7d3c2qio">String</p></td><td id="640498edcc283" rowspan="1" colspan="1"><p jc="left" uuid="lwyfh6rauag4y9mm0yk" id="ce1ba748d93nv">执行错误请求的输出文件<span class="help-letter-space"></span>id。</p></td></tr><tr id="e42cf209ccpl0"><td id="7d582b0c1dchj" rowspan="1" colspan="1"><p jc="left" uuid="lwyfhl5ezp0bh4buo89" id="f15c848886z9s">created_at</p></td><td id="ff4d855169wwl" rowspan="1" colspan="1"><p jc="left" uuid="lwyniz810mge1ua76q0d" id="a3039a8a14lsp">Integer</p></td><td id="d91003af8fcka" rowspan="1" colspan="1"><p jc="left" uuid="lwyfh6m5w9e3fxr9pi" id="421900ee64g95">任务创建的<span class="help-letter-space"></span>Unix 时间戳（秒）。</p></td></tr><tr id="d7ac071942es0"><td id="ca524d1b5fa2u" rowspan="1" colspan="1"><p jc="left" uuid="lwyfh6gidxc6jo60kmj" id="3bf891bd7byuf">in_progress_at</p></td><td id="d216b22885p7y" rowspan="1" colspan="1"><p jc="left" uuid="lwyniz82a285u44a6p9" id="693d5b88eaue6">Integer</p></td><td id="26c9a85669gd4" rowspan="1" colspan="1"><p jc="left" uuid="lwyfh6gi2su284n072p" id="c26bb69f4cdqf">任务开始运行的<span class="help-letter-space"></span>Unix<span class="help-letter-space"></span>时间戳（秒）。</p></td></tr><tr id="de82ae1d01yt5"><td id="0565082540fk2" rowspan="1" colspan="1"><p jc="left" uuid="lwyfh5qn6cqg9i8o87p" id="32fc24d4946re">expires_at</p></td><td id="c38195437elsq" rowspan="1" colspan="1"><p jc="left" uuid="lwyniz84sz3wg9sdjzd" id="07e185ff1e88x">Integer</p></td><td id="4e04f6a201f21" rowspan="1" colspan="1"><p jc="left" uuid="lwyfh5qnja5idbbiuoj" id="c9625f9ba4pra">任务开始超时的时间戳（秒）。</p></td></tr><tr id="ad5dcdb375ews"><td id="88dbaafbf9flg" rowspan="1" colspan="1"><p jc="left" uuid="lwyfhuzxosjrh3sa3ur" id="da89e3decau8d">finalizing_at</p></td><td id="aeb899feb508x" rowspan="1" colspan="1"><p jc="left" uuid="lwyniz85uqz8rmtfd" id="546a6c6aa3001">Integer</p></td><td id="786f56c0b4tod" rowspan="1" colspan="1"><p jc="left" uuid="lwyfhuzxl6ls0mzdcj" id="4df5feffecde3">任务最后开始时间戳（秒）。</p></td></tr><tr id="8668bb7118tkf"><td id="30afdb4e98f1g" rowspan="1" colspan="1"><p jc="left" uuid="lwyfhuusxusgrh8okt" id="f4ae909223d8b">completed_at</p></td><td id="663822c6096mb" rowspan="1" colspan="1"><p jc="left" uuid="lwyniz86wz5q3oz6s1" id="475f451fc2zyg">Integer</p></td><td id="da7847f5159ta" rowspan="1" colspan="1"><p jc="left" uuid="lwyfhuus1mcpm3qekzm" id="a5d7a6dd2453o">任务完成的时间戳（秒）。</p></td></tr><tr id="cde589630beg7"><td id="a181a7e15cgwj" rowspan="1" colspan="1"><p jc="left" uuid="lwyfhupbaa6p85px8i" id="4d2404373dfow">failed_at</p></td><td id="bd5dd5b25c2fg" rowspan="1" colspan="1"><p jc="left" uuid="lwyniz8795ko1aze9ns" id="aedc6bbadfh3r">Integer</p></td><td id="a101ea9fde1re" rowspan="1" colspan="1"><p jc="left" uuid="lwyfhupb8oj9duf61cf" id="7441a87936p5x">任务失败的时间戳（秒）。</p></td></tr><tr id="561a7300502iy"><td id="e432371c9f00b" rowspan="1" colspan="1"><p jc="left" uuid="lwyfhsrrc5vti3j3nyk" id="3989ad1bf9fa6">expired_at</p></td><td id="d1dc297f6ckhi" rowspan="1" colspan="1"><p jc="left" uuid="lwyniz88nwq5jsbkmc" id="4ca489bd824ju">Integer</p></td><td id="7f54c30acasby" rowspan="1" colspan="1"><p jc="left" uuid="lwyfhsrrjcidfb4uu8d" id="09fb2fac231nx">任务超时的时间戳（秒）。</p></td></tr><tr id="2256269432eii"><td id="0c223057f4pyw" rowspan="1" colspan="1"><p jc="left" uuid="lwyfj2n3h6tpgesnmok" id="c96b6a64cednd">cancelling_at</p></td><td id="0499e19048fex" rowspan="1" colspan="1"><p jc="left" uuid="lwyniz89fzaunlba6h8" id="e9800b6e4dcx9">Integer</p></td><td id="33aaa81c10g2l" rowspan="1" colspan="1"><p jc="left" uuid="lwyfj2n3uqud11ak3p" id="815cd608bajgf">任务设置为取消中的时间戳（秒）。</p></td></tr><tr id="b0b8220886u1n"><td id="64a8409009quz" rowspan="1" colspan="1"><p jc="left" uuid="lwyfj2gmv5s6n0k9to" id="909e82fa3amdr">cancelled_at</p></td><td id="28fac7aafau0j" rowspan="1" colspan="1"><p jc="left" uuid="lwyniz8a97bz1etrpup" id="46ccd097edr2b">Integer</p></td><td id="dded782712zsn" rowspan="1" colspan="1"><p jc="left" uuid="lwyfj2gmhjk5qkmskg" id="5b01b62fbeb13">任务取消的时间戳（秒）。</p></td></tr><tr id="deaeee07a0ij5"><td id="b84678071dyuy" rowspan="1" colspan="1"><p jc="left" uuid="lwyfj2ambnxf1ko61g" id="e5d9d7eee7uf3">request_counts</p></td><td id="b74a4f324bv1g" rowspan="1" colspan="1"><p jc="left" uuid="lwyniz8bdp5kx7myawa" id="f02b2f17e0g9g">Map</p></td><td id="e044cb596b8p4" rowspan="1" colspan="1"><p jc="left" uuid="lwyfj2amu2k5aitukc9" id="a3a25ee513lzs">不同状态的请求数量。</p></td></tr><tr id="24d1069098m4e"><td id="983301a3ace29" rowspan="1" colspan="1"><p jc="left" uuid="lwyfj1qj8ca4of4foin" id="b9024b60cbxoz">metadata</p></td><td id="7a26ff3c4ehvt" rowspan="1" colspan="1"><p jc="left" uuid="lwyniz8c036uw0f700mv" id="091872d974thq">Map</p></td><td id="ab6cec9802hym" rowspan="1" colspan="1"><p jc="left" uuid="lwyfj1qjcyoiezrqy76" id="40e9605500bwu">附加信息，键值对。</p></td></tr><tr id="35ec696652zfv"><td id="de51f722e44yj" rowspan="1" colspan="1"><p jc="left" id="40087db530ess">metadata.ds_name</p></td><td id="61e7fb06f2efp" rowspan="1" colspan="1"><p jc="left" id="7f338b87b9kfp">String</p></td><td id="29fae9ab571s8" rowspan="1" colspan="1"><p jc="left" id="7286fa414fno9">当前任务的任务名称。</p></td></tr><tr id="473e18f4fdkyh"><td id="05ca15e093ko3" rowspan="1" colspan="1"><p jc="left" id="a0102a5a0acdp">metadata.ds_description</p></td><td id="4551038bdbco0" rowspan="1" colspan="1"><p jc="left" id="61d695f975jg6">String</p></td><td id="a28a3292ce6z6" rowspan="1" colspan="1"><p jc="left" id="1d482f50c3txh">当前任务的任务描述。</p></td></tr></tbody></table>

### 3\. 查询**与管理 Batch 任务**

任务创建后，您可以通过以下接口查询其状态、列出历史任务或取消正在进行的任务。

#### 查询指定任务状态

通过传入 Batch 任务 ID，来查询指定 Batch 任务的信息。当前仅支持查询 30 天之内创建的 Batch 任务。

## OpenAI Python SDK

#### 请求示例

```python
import os
from openai import OpenAI

client = OpenAI(
    # 若没有配置环境变量，可用阿里云百炼API Key将下行替换为：api_key="sk-xxx"。但不建议在生产环境中直接将API Key硬编码到代码中，以减少API Key泄露风险。
    # 新加坡和北京地域的API Key不同。
    api_key=os.getenv("DASHSCOPE_API_KEY"),
    # 以下是北京地域base_url，如果使用新加坡地域的模型，需要将base_url替换为：https://dashscope-intl.aliyuncs.com/compatible-mode/v1
    # 注意：切换地域时，API Key也需要对应更换
    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
)
batch = client.batches.retrieve("batch_id")  # 将batch_id替换为Batch任务的id
print(batch)
```

## OpenAI Node.js SDK

#### 请求示例

```javascript
/**
 * 阿里云百炼 Batch API - 查询单个任务
 * 
 * 若没有配置环境变量，可在代码中硬编码API Key：apiKey: 'sk-xxx'
 * 但不建议在生产环境中直接将API Key硬编码到代码中，以减少API Key泄露风险。
 * 新加坡和北京地域的API Key不同。
 * 
 * 安装依赖：npm install openai
 */
const OpenAI = require('openai');

// 北京地域配置（默认）
const BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
// 如果使用新加坡地域，请将上面的 BASE_URL 替换为：
// const BASE_URL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
// 注意：切换地域时，API Key也需要对应更换

const apiKey = process.env.DASHSCOPE_API_KEY;
if (!apiKey) {
    console.error('错误: 请设置环境变量 DASHSCOPE_API_KEY');
    console.error('或在代码中设置: const apiKey = "sk-xxx";');
    process.exit(1);
}

const client = new OpenAI({
    apiKey: apiKey,
    baseURL: BASE_URL
});

const batch = await client.batches.retrieve('batch_id');
console.log(batch.status);
```

## Java（HTTP）

#### 请求示例

```java
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Scanner;
import java.util.regex.Pattern;
import java.util.regex.Matcher;

/**
 * 阿里云百炼 Batch API - 查询单个任务
 * 
 * 若没有配置环境变量，可在代码中硬编码API Key：API_KEY = "sk-xxx"
 * 但不建议在生产环境中直接将API Key硬编码到代码中，以减少API Key泄露风险。
 * 新加坡和北京地域的API Key不同。
 * 
 * 地域配置：
 * - 北京地域：https://dashscope.aliyuncs.com/compatible-mode/v1
 * - 新加坡地域：https://dashscope-intl.aliyuncs.com/compatible-mode/v1
 * 注意：切换地域时，API Key也需要对应更换
 */
public class BatchAPIRetrieveBatch {
    
    // 北京地域配置（默认）
    private static final String BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
    // 如果使用新加坡地域，请将上面的 BASE_URL 替换为：
    // private static final String BASE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
    // 注意：切换地域时，API Key也需要对应更换
    
    private static String API_KEY;
    
    public static void main(String[] args) throws Exception {
        API_KEY = System.getenv("DASHSCOPE_API_KEY");
        if (API_KEY == null || API_KEY.isEmpty()) {
            System.err.println("错误: 请设置环境变量 DASHSCOPE_API_KEY");
            System.err.println("或在代码中设置: API_KEY = \"sk-xxx\";");
            System.exit(1);
        }
        
        String batchInfo = sendRequest("GET", "/batches/batch_id", null);
        String status = parseField(batchInfo, "\"status\":\\s*\"([^\"]+)\"");
        System.out.println("任务状态: " + status);
    }
    
    // === 工具方法 ===
    
    private static String sendRequest(String method, String path, String jsonBody) throws Exception {
        URL url = new URL(BASE_URL + path);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod(method);
        conn.setRequestProperty("Authorization", "Bearer " + API_KEY);
        
        if (jsonBody != null) {
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json");
            try (OutputStream os = conn.getOutputStream()) {
                os.write(jsonBody.getBytes("UTF-8"));
            }
        }
        
        return readResponse(conn);
    }
    
    private static String readResponse(HttpURLConnection conn) throws Exception {
        int responseCode = conn.getResponseCode();
        InputStream is = (responseCode < 400) ? conn.getInputStream() : conn.getErrorStream();
        try (Scanner scanner = new Scanner(is, "UTF-8").useDelimiter("\\A")) {
            return scanner.hasNext() ? scanner.next() : "";
        }
    }
    
    private static String parseField(String json, String regex) {
        Pattern pattern = Pattern.compile(regex);
        Matcher matcher = pattern.matcher(json);
        return matcher.find() ? matcher.group(1) : null;
    }
}
```

## curl(HTTP)

#### 请求示例

```curl
# ======= 重要提示 =======
# 新加坡和北京地域的API Key不同。
# 以下是北京地域base_url，如果使用新加坡地域的模型，需要将base_url替换为：https://dashscope-intl.aliyuncs.com/compatible-mode/v1/batches/batch_id
# === 执行时请删除该注释 ===
curl --request GET 'https://dashscope.aliyuncs.com/compatible-mode/v1/batches/batch_id' \
 -H "Authorization: Bearer $DASHSCOPE_API_KEY"
```

#### **返回示例**

查询成功后返回 Batch 任务的详细信息。以下是一个 completed 状态的返回示例：

```json
{
  "id": "batch_abc123",
  "object": "batch",
  "endpoint": "/v1/chat/completions",
  "errors": null,
  "input_file_id": "file-abc123",
  "completion_window": "24h",
  "status": "completed",
  "output_file_id": "file-batch_output-xyz789",
  "error_file_id": "file-batch_error-xyz789",
  "created_at": 1711402400,
  "in_progress_at": 1711402450,
  "expires_at": 1711488800,
  "finalizing_at": 1711405000,
  "completed_at": 1711406000,
  "failed_at": null,
  "expired_at": null,
  "cancelling_at": null,
  "cancelled_at": null,
  "request_counts": {
    "total": 100,
    "completed": 95,
    "failed": 5
  },
  "metadata": {
    "customer_id": "user_123456789",
    "batch_description": "Nightly eval job"
  }
}
```

返回的 JSON 对象包含 Batch 任务的完整信息，包括任务状态、结果文件 ID、请求统计等。字段详细说明见下表。

<table id="50cc3f93aa0le" tablewidth="576" tablecolswidth="147 83 346" autofit="false" class="table"><colgroup colwidth="0.77*"></colgroup><colgroup colwidth="0.43*"></colgroup><colgroup colwidth="1.8*"></colgroup><tbody class="tbody"><tr id="e2e619a725azz"><td id="f0e9d2a7750yq" rowspan="1" colspan="1"><p jc="left" id="782100e539rnt"><b>字段</b></p></td><td id="ff231324698rn" rowspan="1" colspan="1"><p jc="left" id="b1f0677ba1rul"><b>类型</b></p></td><td id="31b7d6ebf6mpe" rowspan="1" colspan="1"><p jc="left" id="1e58451d9b194"><b>描述</b></p></td></tr><tr id="d792863202u7y"><td id="ee4bc9bef9f8k" rowspan="1" colspan="1"><p jc="left" id="a069e746da2ok">id</p></td><td id="365ca703a42lc" rowspan="1" colspan="1"><p jc="left" id="a6ea956a0dor8">String</p></td><td id="d31d1e10a7are" rowspan="1" colspan="1"><p jc="left" id="ae4a72ea2ft4j">Batch<span class="help-letter-space"></span>任务<span class="help-letter-space"></span>ID。</p></td></tr><tr id="82d4543676u2q"><td id="15c6dc806cut9" rowspan="1" colspan="1"><p jc="left" id="0d35c6d1a1ovn">status</p></td><td id="d0ca442008hsr" rowspan="1" colspan="1"><p jc="left" id="2dda23c7b1ur1">String</p></td><td id="0713d9d7desaz" rowspan="1" colspan="1"><p jc="left" id="41fc7b9b50cxu">任务状态，可能的值包括：</p><ul node="[object Object]" class="markdown-ul___Dsttp" id="982d3b68acirk"><li node="[object Object]" class="markdown-li____r05t" id="79482dd4c7uf2"><p id="8b6d0f31b7d36">validating：正在验证输入文件。</p></li><li node="[object Object]" class="markdown-li____r05t" id="f71f7f143a0va"><p id="837a83b341w17">in_progress：任务正在处理中。</p></li><li node="[object Object]" class="markdown-li____r05t" id="1d466bdc0e8gl"><p id="2082833e757v3">finalizing：任务已完成处理，正在生成输出文件。</p></li><li node="[object Object]" class="markdown-li____r05t" id="6f73ae974e2rl"><p id="b25c27e3444ed">completed：任务成功完成。</p></li><li node="[object Object]" class="markdown-li____r05t" id="8bc1c04f67fap"><p id="35a156448e2r4">failed：任务因严重错误失败。</p></li><li node="[object Object]" class="markdown-li____r05t" id="72ea8f072d563"><p id="ed2c8b76172x3">expired：任务在 completion_window 内未能完成而过期。</p></li><li node="[object Object]" class="markdown-li____r05t" id="d6687447830iy"><p id="bcd240dd84r79">cancelling：正在取消任务。</p></li><li node="[object Object]" class="markdown-li____r05t" id="46bd9fe6e4ktp"><p id="7f51448e0btox">cancelled：任务已被取消。</p></li></ul></td></tr><tr id="3f5f63a1a4moz"><td id="2b20536889jyi" rowspan="1" colspan="1"><p jc="left" id="d411fde10fh5c">output_file_id</p></td><td id="5aede343dfr14" rowspan="1" colspan="1"><p jc="left" id="43bf3e8c8dtmc">String</p></td><td id="3a44f2b00f1zd" rowspan="1" colspan="1"><p jc="left" id="aacd23ff7erqo">成功结果文件的<span class="help-letter-space"></span>ID，任务完成后生成。</p></td></tr><tr id="9074821094r0o"><td id="ba73146329yys" rowspan="1" colspan="1"><p jc="left" id="63a71e4cccgkf">error_file_id</p></td><td id="f49ec8ff8fg27" rowspan="1" colspan="1"><p jc="left" id="415d0b4dbeiu9">String</p></td><td id="b536af29d9mn6" rowspan="1" colspan="1"><p jc="left" id="9b8f98d2816mi">失败结果文件的<span class="help-letter-space"></span>ID，任务完成后且有失败请求时生成。</p></td></tr><tr id="98251973b4ugu"><td id="62aed86258gka" rowspan="1" colspan="1"><p jc="left" id="8e0f0f96078hf">request_counts</p></td><td id="aa17635d19h05" rowspan="1" colspan="1"><p jc="left" id="94c5a24e6erua">Object</p></td><td id="63c1629365ru9" rowspan="1" colspan="1"><p jc="left" id="3c7cea215bldn">包含<span class="help-letter-space"></span>total, completed, failed 数量的统计对象。</p></td></tr></tbody></table>

#### **查询任务列表**

可使用 `batches.list()` 方法查询 Batch 任务列表，通过分页机制逐步获取完整的任务列表。

## OpenAI Python SDK

#### **请求示例**

```python
import os
from openai import OpenAI

client = OpenAI(
    # 若没有配置环境变量，可用阿里云百炼API Key将下行替换为：api_key="sk-xxx"。但不建议在生产环境中直接将API Key硬编码到代码中，以减少API Key泄露风险。
    # 新加坡和北京地域的API Key不同。
    api_key=os.getenv("DASHSCOPE_API_KEY"),
    # 以下是北京地域base_url，如果使用新加坡地域的模型，需要将base_url替换为：https://dashscope-intl.aliyuncs.com/compatible-mode/v1
    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
)
batches = client.batches.list(after="batch_xxx", limit=2,extra_query={'ds_name':'任务名称','input_file_ids':'file-batch-xxx,file-batch-xxx','status':'completed,expired','create_after':'20250304000000','create_before':'20250306123000'})
print(batches)
```

## OpenAI Node.js SDK

#### 请求示例

```javascript
/**
 * 阿里云百炼 Batch API - 查询任务列表
 * 
 * 若没有配置环境变量，可在代码中硬编码API Key：apiKey: 'sk-xxx'
 * 但不建议在生产环境中直接将API Key硬编码到代码中，以减少API Key泄露风险。
 * 新加坡和北京地域的API Key不同。
 * 
 * 安装依赖：npm install openai
 */
const OpenAI = require('openai');

// 北京地域配置（默认）
const BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
// 如果使用新加坡地域，请将上面的 BASE_URL 替换为：
// const BASE_URL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
// 注意：切换地域时，API Key也需要对应更换

const apiKey = process.env.DASHSCOPE_API_KEY;
if (!apiKey) {
    console.error('错误: 请设置环境变量 DASHSCOPE_API_KEY');
    console.error('或在代码中设置: const apiKey = "sk-xxx";');
    process.exit(1);
}

const client = new OpenAI({
    apiKey: apiKey,
    baseURL: BASE_URL
});

const batches = await client.batches.list({
    after: 'batch_xxx',
    limit: 2,
    extra_query: {
        'ds_name': '任务名称',
        'input_file_ids': 'file-batch-xxx,file-batch-xxx',
        'status': 'completed,expired',
        'create_after': '20250304000000',
        'create_before': '20250306123000'
    }
});

for (const batch of batches.data) {
    console.log(batch.id, batch.status);
}
```

## Java（HTTP）

#### 请求示例

```java
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Scanner;
import java.util.regex.Pattern;
import java.util.regex.Matcher;

/**
 * 阿里云百炼 Batch API - 查询任务列表
 * 
 * 若没有配置环境变量，可在代码中硬编码API Key：API_KEY = "sk-xxx"
 * 但不建议在生产环境中直接将API Key硬编码到代码中，以减少API Key泄露风险。
 * 新加坡和北京地域的API Key不同。
 * 
 * 地域配置：
 * - 北京地域：https://dashscope.aliyuncs.com/compatible-mode/v1
 * - 新加坡地域：https://dashscope-intl.aliyuncs.com/compatible-mode/v1
 * 注意：切换地域时，API Key也需要对应更换
 */
public class BatchAPIListBatches {
    
    // 北京地域配置（默认）
    private static final String BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
    // 如果使用新加坡地域，请将上面的 BASE_URL 替换为：
    // private static final String BASE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
    // 注意：切换地域时，API Key也需要对应更换
    
    private static String API_KEY;
    
    public static void main(String[] args) throws Exception {
        API_KEY = System.getenv("DASHSCOPE_API_KEY");
        if (API_KEY == null || API_KEY.isEmpty()) {
            System.err.println("错误: 请设置环境变量 DASHSCOPE_API_KEY");
            System.err.println("或在代码中设置: API_KEY = \"sk-xxx\";");
            System.exit(1);
        }
        
        String response = sendRequest("GET", "/batches?after=batch_xxx&limit=2&ds_name=Batch&input_file_ids=file-batch-xxx,file-batch-xxx&status=completed,failed&create_after=20250303000000&create_before=20250320000000", null);
// 解析 JSON 获取任务列表
        System.out.println(response);
    }
    
    // === 工具方法 ===
    
    private static String sendRequest(String method, String path, String jsonBody) throws Exception {
        URL url = new URL(BASE_URL + path);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod(method);
        conn.setRequestProperty("Authorization", "Bearer " + API_KEY);
        
        if (jsonBody != null) {
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json");
            try (OutputStream os = conn.getOutputStream()) {
                os.write(jsonBody.getBytes("UTF-8"));
            }
        }
        
        return readResponse(conn);
    }
    
    private static String readResponse(HttpURLConnection conn) throws Exception {
        int responseCode = conn.getResponseCode();
        InputStream is = (responseCode < 400) ? conn.getInputStream() : conn.getErrorStream();
        try (Scanner scanner = new Scanner(is, "UTF-8").useDelimiter("\\A")) {
            return scanner.hasNext() ? scanner.next() : "";
        }
    }
    
    private static String parseField(String json, String regex) {
        Pattern pattern = Pattern.compile(regex);
        Matcher matcher = pattern.matcher(json);
        return matcher.find() ? matcher.group(1) : null;
    }
}
```

## curl(HTTP)

#### 请求示例

```curl
# ======= 重要提示 =======
# 新加坡和北京地域的API Key不同。
# 以下是北京地域base_url，如果使用新加坡地域的模型，需要将base_url替换为：https://dashscope-intl.aliyuncs.com/compatible-mode/v1/batches?xxx同下方内容xxx
# === 执行时请删除该注释 ===
curl --request GET  'https://dashscope.aliyuncs.com/compatible-mode/v1/batches?after=batch_xxx&limit=2&ds_name=Batch&input_file_ids=file-batch-xxx,file-batch-xxx&status=completed,failed&create_after=20250303000000&create_before=20250320000000' \
 -H "Authorization: Bearer $DASHSCOPE_API_KEY"
```

> 将`after=batch_id`中的`batch_id`替换为实际值，`limit`参数设置为返回任务的数量，`ds_name`填写为任务名称片段，input\_file\_ids的值可填写多个文件ID，`status`填写Batch任务的多个状态，`create_after`和`create_before`的值填写为时间点。

#### **输入参数**

<table id="6f0c932e7bzsa" tablewidth="485" tablecolswidth="52 58 66 52 257" autofit="false" class="table"><colgroup colwidth="0.54*"></colgroup><colgroup colwidth="0.6*"></colgroup><colgroup colwidth="0.68*"></colgroup><colgroup colwidth="0.54*"></colgroup><colgroup colwidth="2.65*"></colgroup><tbody class="tbody"><tr id="c9d86c20c7k2r"><td id="99b56061e12q3" rowspan="1" colspan="1"><p jc="left" uuid="lzb034d945syqpebmf5" id="15688185a9nf7"><b>字段</b></p></td><td id="ebdbb01129dlx" rowspan="1" colspan="1"><p jc="left" uuid="lzb034d98ha6ubbi30u" id="b465499af3151"><b>类型</b></p></td><td id="7648a2db2fzko" rowspan="1" colspan="1"><p jc="left" uuid="lzb034d9jne91l1khxd" id="7310ac0bd2r79"><b>传参方式</b></p></td><td id="a5a9779b045v5" rowspan="1" colspan="1"><p jc="left" uuid="lzb034d9od75l9rjlcl" id="89bc2aacb8mla"><b>必选</b></p></td><td id="17d8d309efuqt" rowspan="1" colspan="1"><p jc="left" uuid="lzb034d9nooojmxk2q" id="6568d671ads3t"><b>描述</b></p></td></tr><tr id="26062e25d1wsj"><td id="29df22831atnf" rowspan="1" colspan="1"><p jc="left" uuid="lzb3hlb3s64gexrs4m" id="122a3bfb7e7mf">after</p></td><td id="cf0fcce8c0xmm" rowspan="1" colspan="1"><p jc="left" uuid="lzb3hlb4tibfjntxgp" id="2918338cd1vjl">String</p></td><td id="55728fcde7g7c" rowspan="1" colspan="1"><p jc="left" uuid="lzb3hlb40i9v0snlwrp" id="de34ca123cr03">Query</p></td><td id="7e8c283434i2a" rowspan="1" colspan="1"><p jc="left" uuid="lzb3hlb4g3brpdxo80n" id="628ff7bdab0qk">否</p></td><td id="95e941eef48q3" rowspan="1" colspan="1"><p jc="left" id="eb361a09105f7">用于分页的游标，值为上一页最后一个任务的<span class="help-letter-space"></span>ID。</p></td></tr><tr id="cd5890cb1913m"><td id="667bec2d11a2y" rowspan="1" colspan="1"><p jc="left" uuid="lzb3jiznidsi3j6lt0k" id="478e5b134bt4i">limit</p></td><td id="aea39255bbjco" rowspan="1" colspan="1"><p jc="left" uuid="lzb3jizosf8nd9fxuug" id="0fc1615cbbmav">Integer</p></td><td id="99d7515fbb8ki" rowspan="1" colspan="1"><p jc="left" uuid="lzb3jizodq68qiqdgpm" id="5aaf5d1d3damz">Query</p></td><td id="25c5d35616klf" rowspan="1" colspan="1"><p jc="left" uuid="lzb3jizoc3xzzi5d0ba" id="d0c49d72619pl">否</p></td><td id="4d48ed5ab2zd3" rowspan="1" colspan="1"><p jc="left" uuid="lzb3jizo4p6a60lantw" id="625d9b6ba55t8">每页返回的任务数量，范围[1, 100]，默认<span class="help-letter-space"></span>20。</p></td></tr><tr id="059addecafwz6"><td id="3ed923a11am9c" rowspan="1" colspan="1"><p jc="left" id="2797c65db77le">ds_name</p></td><td id="2409f45e46kw7" rowspan="1" colspan="1"><p jc="left" uuid="lzb3hlb4tibfjntxgp" id="122c910c586oe">String</p></td><td id="58db046f4d5q7" rowspan="1" colspan="1"><p jc="left" uuid="lzb3hlb40i9v0snlwrp" id="037c278eceyjk">Query</p></td><td id="656ae055a4b1c" rowspan="1" colspan="1"><p jc="left" uuid="lzb3hlb4g3brpdxo80n" id="62f5333252d4e">否</p></td><td id="fb42863af6vu5" rowspan="1" colspan="1"><p jc="left" id="5b8dc1a1fd3ks">按任务名称进行模糊匹配。</p></td></tr><tr id="ad7989ce31ytr"><td id="82b047ee4fn4z" rowspan="1" colspan="1"><p jc="left" id="b1a6edb4cdz2a">input_file_ids</p></td><td id="19801de08awxx" rowspan="1" colspan="1"><p jc="left" uuid="lzb3hlb4tibfjntxgp" id="7e611c3616at1">String</p></td><td id="b24da321eb4xa" rowspan="1" colspan="1"><p jc="left" uuid="lzb3hlb40i9v0snlwrp" id="a0808ee68ahzw">Query</p></td><td id="bea33c224agtv" rowspan="1" colspan="1"><p jc="left" uuid="lzb3hlb4g3brpdxo80n" id="ec8007d976lrb">否</p></td><td id="adad29acafj34" rowspan="1" colspan="1"><p jc="left" id="1d92e6bd3bxhz">按文件 ID 筛选，多个 ID 用逗号分隔，最多<span class="help-letter-space"></span>20<span class="help-letter-space"></span>个。</p></td></tr><tr id="f7c718df47yti"><td id="c2d5188a059at" rowspan="1" colspan="1"><p jc="left" id="283a728e8f94g">status</p></td><td id="420ef48a44qn1" rowspan="1" colspan="1"><p jc="left" id="1afc93b276056">String</p></td><td id="7b1178eb7492t" rowspan="1" colspan="1"><p jc="left" uuid="lzb3jizodq68qiqdgpm" id="7105d32b44b6k">Query</p></td><td id="3c358a7f9civp" rowspan="1" colspan="1"><p jc="left" uuid="lzb3jizoc3xzzi5d0ba" id="9af1b98534n8s">否</p></td><td id="9390135f0c5ij" rowspan="1" colspan="1"><p jc="left" uuid="lzb3jizo4p6a60lantw" id="6c95ba5814aof">按任务状态筛选，多个状态用逗号分隔。</p></td></tr><tr id="6c579909b5puc"><td id="70b266f55fpwa" rowspan="1" colspan="1"><p jc="left" id="b9cab4fbd9z1v">create_after</p></td><td id="ed034c00bcsms" rowspan="1" colspan="1"><p jc="left" id="b2ebacc8e8y63">String</p></td><td id="f1eeec3387891" rowspan="1" colspan="1"><p jc="left" uuid="lzb3jizodq68qiqdgpm" id="23566ed0f393v">Query</p></td><td id="dc15cad9f0wie" rowspan="1" colspan="1"><p jc="left" uuid="lzb3jizoc3xzzi5d0ba" id="41083f7759oiu">否</p></td><td id="2a43c562d49in" rowspan="1" colspan="1"><p jc="left" id="cda41af81epnr">筛选在此时间点之后创建的任务，格式：<code data-tag="code" id="f33e47ba85xws" class="code">yyyyMMddHHmmss</code>。</p></td></tr><tr id="b229f5f1d0mm9"><td id="27c61bdf850fq" rowspan="1" colspan="1"><p jc="left" id="d94ee5bc03n00">create_before</p></td><td id="2a888260a3379" rowspan="1" colspan="1"><p jc="left" id="0ceac53cb9bqr">String</p></td><td id="90388172d2wba" rowspan="1" colspan="1"><p jc="left" uuid="lzb3jizodq68qiqdgpm" id="040bfb07b04tg">Query</p></td><td id="407ff4013d7s6" rowspan="1" colspan="1"><p jc="left" uuid="lzb3jizoc3xzzi5d0ba" id="c5a5c66d99cqj">否</p></td><td id="6654833c8f6om" rowspan="1" colspan="1"><p jc="left" id="233c46deda0mw">筛选在此时间点之前创建的任务，格式：<code data-tag="code" id="2857bc668e8er" class="code">yyyyMMddHHmmss</code>。</p></td></tr></tbody></table>

#### **返回示例**

```json
{
  "object": "list",
  "data": [
    {
      "id": "batch_xxx",
      "object": "batch",
      "endpoint": "/v1/chat/completions",
      "errors": null,
      "input_file_id": "file-batch-xxx",
      "completion_window": "24h",
      "status": "completed",
      "output_file_id": "file-batch_output-xxx",
      "error_file_id": null,
      "created_at": 1722234109,
      "in_progress_at": 1722234109,
      "expires_at": null,
      "finalizing_at": 1722234165,
      "completed_at": 1722234165,
      "failed_at": null,
      "expired_at": null,
      "cancelling_at": null,
      "cancelled_at": null,
      "request_counts": {
        "total": 100,
        "completed": 95,
        "failed": 5
      },
      "metadata": {}
    },
    { ... }
  ],
  "first_id": "batch_xxx",
  "last_id": "batch_xxx",
  "has_more": true
}
```

#### **返回参数**

<table id="3844823e1080p" tablewidth="100" tablecolswidth="18.26 17.39 64.35" autofit="true" class="table"><colgroup colwidth="0.55*"></colgroup><colgroup colwidth="0.53*"></colgroup><colgroup colwidth="1.95*"></colgroup><tbody class="tbody"><tr id="44b3f0a407p8r"><td id="86ec005e587hh" rowspan="1" colspan="1"><p jc="left" uuid="lzb03ltzqcwwdnquaeb" id="83d95aa72aq8s"><b>字段</b></p></td><td id="19a4f9853aaar" rowspan="1" colspan="1"><p jc="left" uuid="lzb03ltz0qeoq3wstzso" id="96ea55d622804"><b>类型</b></p></td><td id="93d9607a68hrf" rowspan="1" colspan="1"><p jc="left" uuid="lzb03ltzrn5w4uzfvv" id="1d292f51dccrt"><b>描述</b></p></td></tr><tr id="c52947e65cjq3"><td id="b0fbef0bf28a7" rowspan="1" colspan="1"><p jc="left" uuid="lwyfnp77ostl2bfh9gs" id="db9e0c3cc0cid">object</p></td><td id="0c35fd2f1143v" rowspan="1" colspan="1"><p jc="left" uuid="lwyfnp77t5wnd6570zs" id="94f2f1dc64cyz" left="0">String</p></td><td id="827706307dmxn" rowspan="1" colspan="1"><p uuid="lwyfnp774yuw46jmyxt" id="f6d17385ffesq">类型，固定值<span class="help-letter-space"></span>list。</p></td></tr><tr id="5279e8382d3il"><td id="ff821bfc6ck8v" rowspan="1" colspan="1"><p jc="left" uuid="lwyfnp773kgsgc9poe" id="b4c13d62ab1i4">data</p></td><td id="430613f4f3pnq" rowspan="1" colspan="1"><p jc="left" uuid="lwyfnp77ucrdos4yli" id="a4edc297e7zu2">Array</p></td><td id="d1f3bd5da0yhp" rowspan="1" colspan="1"><p uuid="lwyfnp77vw9be4cafti" id="986f1cc25bpzc">Batch<span class="help-letter-space"></span>任务对象，参见创建<span class="help-letter-space"></span>Batch<span class="help-letter-space"></span>任务的返回参数。</p></td></tr><tr id="10eceb3a1djjb"><td id="17086d03935ap" rowspan="1" colspan="1"><p jc="left" uuid="lwypbmkz0ej56gag4u0d" id="fbf39ecc3ewwm">first_id</p></td><td id="a85e28a289lps" rowspan="1" colspan="1"><p jc="left" uuid="lwypd92e3vftbwjqlxm" id="ab5bfb0234qhf">String</p></td><td id="bb23387ba9vg8" rowspan="1" colspan="1"><p uuid="lwypbmkzm88c7vkm0he" id="74d3ed1898wr1">当前页第一个 Batch<span class="help-letter-space"></span>任务 ID。</p></td></tr><tr id="ef114d52815nz"><td id="252c990bfap26" rowspan="1" colspan="1"><p jc="left" uuid="lwypc375bfaceqhped" id="81557686affb1">last_id</p></td><td id="6fa4176afa35g" rowspan="1" colspan="1"><p jc="left" uuid="lwypd92f97ev2wpkc0b" id="17bbfacb17qn0">String</p></td><td id="a362b01d6703k" rowspan="1" colspan="1"><p uuid="lwypc37585422fb5cp3" id="f9d4456dd40b0">当前页最后一个<span class="help-letter-space"></span>Batch<span class="help-letter-space"></span>任务 ID。</p></td></tr><tr id="76090976c4pqe"><td id="f3bbcb383dzue" rowspan="1" colspan="1"><p jc="left" uuid="lwypd4bgsq7wes40fc9" id="c1ed20ab4dac0">has_more</p></td><td id="548769c013blm" rowspan="1" colspan="1"><p jc="left" uuid="lwypd92gh7qiwuf4hv" id="9f7a0e262ci0s">Boolean</p></td><td id="592213bd99523" rowspan="1" colspan="1"><p uuid="lwypd3ivt8blbwsjbpi" id="c7cee83bechys">是否有下一页。</p></td></tr></tbody></table>

#### **取消Batch任务**

取消一个正在进行或排队中的任务。成功调用后，任务状态将变为 cancelling，最终变为 cancelled。在任务被完全取消前，已完成的部分仍会计费。

## OpenAI Python SDK

#### 请求示例

```python
import os
from openai import OpenAI

client = OpenAI(
    # 若没有配置环境变量，可用阿里云百炼API Key将下行替换为：api_key="sk-xxx"。但不建议在生产环境中直接将API Key硬编码到代码中，以减少API Key泄露风险。
    # 新加坡和北京地域的API Key不同。
    api_key=os.getenv("DASHSCOPE_API_KEY"),
    # 以下是北京地域base_url，如果使用新加坡地域的模型，需要将base_url替换为：https://dashscope-intl.aliyuncs.com/compatible-mode/v1
    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
)
batch = client.batches.cancel("batch_id")  # 将batch_id替换为Batch任务的id
print(batch)
```

## OpenAI Node.js SDK

#### 请求示例

```javascript
/**
 * 阿里云百炼 Batch API - 取消任务
 * 
 * 若没有配置环境变量，可在代码中硬编码API Key：apiKey: 'sk-xxx'
 * 但不建议在生产环境中直接将API Key硬编码到代码中，以减少API Key泄露风险。
 * 新加坡和北京地域的API Key不同。
 * 
 * 安装依赖：npm install openai
 */
const OpenAI = require('openai');

// 北京地域配置（默认）
const BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
// 如果使用新加坡地域，请将上面的 BASE_URL 替换为：
// const BASE_URL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
// 注意：切换地域时，API Key也需要对应更换

const apiKey = process.env.DASHSCOPE_API_KEY;
if (!apiKey) {
    console.error('错误: 请设置环境变量 DASHSCOPE_API_KEY');
    console.error('或在代码中设置: const apiKey = "sk-xxx";');
    process.exit(1);
}

const client = new OpenAI({
    apiKey: apiKey,
    baseURL: BASE_URL
});

const batch = await client.batches.cancel('batch_id');
console.log(batch.status); // cancelled
```

## Java（HTTP）

#### 请求示例

```java
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Scanner;
import java.util.regex.Pattern;
import java.util.regex.Matcher;

/**
 * 阿里云百炼 Batch API - 取消任务
 * 
 * 若没有配置环境变量，可在代码中硬编码API Key：API_KEY = "sk-xxx"
 * 但不建议在生产环境中直接将API Key硬编码到代码中，以减少API Key泄露风险。
 * 新加坡和北京地域的API Key不同。
 * 
 * 地域配置：
 * - 北京地域：https://dashscope.aliyuncs.com/compatible-mode/v1
 * - 新加坡地域：https://dashscope-intl.aliyuncs.com/compatible-mode/v1
 * 注意：切换地域时，API Key也需要对应更换
 */
public class BatchAPICancelBatch {
    
    // 北京地域配置（默认）
    private static final String BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
    // 如果使用新加坡地域，请将上面的 BASE_URL 替换为：
    // private static final String BASE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
    // 注意：切换地域时，API Key也需要对应更换
    
    private static String API_KEY;
    
    public static void main(String[] args) throws Exception {
        API_KEY = System.getenv("DASHSCOPE_API_KEY");
        if (API_KEY == null || API_KEY.isEmpty()) {
            System.err.println("错误: 请设置环境变量 DASHSCOPE_API_KEY");
            System.err.println("或在代码中设置: API_KEY = \"sk-xxx\";");
            System.exit(1);
        }
        
        String response = sendRequest("POST", "/batches/batch_id/cancel", null);
        System.out.println(response);
    }
    
    // === 工具方法 ===
    
    private static String sendRequest(String method, String path, String jsonBody) throws Exception {
        URL url = new URL(BASE_URL + path);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod(method);
        conn.setRequestProperty("Authorization", "Bearer " + API_KEY);
        
        if (jsonBody != null) {
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json");
            try (OutputStream os = conn.getOutputStream()) {
                os.write(jsonBody.getBytes("UTF-8"));
            }
        }
        
        return readResponse(conn);
    }
    
    private static String readResponse(HttpURLConnection conn) throws Exception {
        int responseCode = conn.getResponseCode();
        InputStream is = (responseCode < 400) ? conn.getInputStream() : conn.getErrorStream();
        try (Scanner scanner = new Scanner(is, "UTF-8").useDelimiter("\\A")) {
            return scanner.hasNext() ? scanner.next() : "";
        }
    }
    
    private static String parseField(String json, String regex) {
        Pattern pattern = Pattern.compile(regex);
        Matcher matcher = pattern.matcher(json);
        return matcher.find() ? matcher.group(1) : null;
    }
}
```

## curl(HTTP)

#### 请求示例

```curl
# ======= 重要提示 =======
# 新加坡和北京地域的API Key不同。
# 以下是北京地域base_url，如果使用新加坡地域的模型，需要将base_url替换为：https://dashscope-intl.aliyuncs.com/compatible-mode/v1/batches/batch_id/cancel
# === 执行时请删除该注释 ===
curl --request POST 'https://dashscope.aliyuncs.com/compatible-mode/v1/batches/batch_id/cancel' \
 -H "Authorization: Bearer $DASHSCOPE_API_KEY"
```

> 将`batch_id`替换为实际值。

#### **返回示例**

取消任务成功后返回 Batch 任务的详细信息。以下是一个 cancelling 状态的返回示例：

```json
{
  "id": "batch_abc123",
  "object": "batch",
  "endpoint": "/v1/chat/completions",
  "errors": null,
  "input_file_id": "file-abc123",
  "completion_window": "24h",
  "status": "cancelling",
  "output_file_id": null,
  "error_file_id": null,
  "created_at": 1711402400,
  "in_progress_at": 1711402450,
  "expires_at": 1711488800,
  "finalizing_at": null,
  "completed_at": null,
  "failed_at": null,
  "expired_at": null,
  "cancelling_at": 1711403000,
  "cancelled_at": null,
  "request_counts": {
    "total": 100,
    "completed": 23,
    "failed": 1
  },
  "metadata": null
}
```

> 取消任务后，状态会先变为 `cancelling`，等待正在执行的请求完成；最终会变为 `cancelled`。已完成的请求结果仍会保存在输出文件中。

### **4\. 下载Batch结果文件**

任务结束后会生成结果文件（output\_file\_id）和可能的错误文件（error\_file\_id），两者均通过相同的文件下载接口获取。

仅支持下载以`file-batch_output`开头的`file_id`对应的文件。

## OpenAI Python SDK

您可以通过`content`方法获取Batch任务结果文件内容，并通过`write_to_file`方法将其保存至本地。

#### 请求示例

```python
import os
from openai import OpenAI

client = OpenAI(
    # 若没有配置环境变量，可用阿里云百炼API Key将下行替换为：api_key="sk-xxx"。但不建议在生产环境中直接将API Key硬编码到代码中，以减少API Key泄露风险。
    # 新加坡和北京地域的API Key不同。
    api_key=os.getenv("DASHSCOPE_API_KEY"),
    # 以下是北京地域base_url，如果使用新加坡地域的模型，需要将base_url替换为：https://dashscope-intl.aliyuncs.com/compatible-mode/v1
    # 注意：切换地域时，API Key也需要对应更换
    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
)
content = client.files.content(file_id="file-batch_output-xxx")
# 打印结果文件内容
print(content.text)
# 保存结果文件至本地
content.write_to_file("result.jsonl")
```

#### 返回示例

```json
{"id":"c308ef7f-xxx","custom_id":"1","response":{"status_code":200,"request_id":"c308ef7f-0824-9c46-96eb-73566f062426","body":{"created":1742303743,"usage":{"completion_tokens":35,"prompt_tokens":26,"total_tokens":61},"model":"qwen-plus","id":"chatcmpl-c308ef7f-0824-9c46-96eb-73566f062426","choices":[{"finish_reason":"stop","index":0,"message":{"content":"你好！当然可以。无论是需要信息查询、学习资料、解决问题的方法，还是其他任何帮助，我都在这里为你提供支持。请告诉我你需要什么方面的帮助？"}}],"object":"chat.completion"}},"error":null}
{"id":"73291560-xxx","custom_id":"2","response":{"status_code":200,"request_id":"73291560-7616-97bf-87f2-7d747bbe84fd","body":{"created":1742303743,"usage":{"completion_tokens":7,"prompt_tokens":26,"total_tokens":33},"model":"qwen-plus","id":"chatcmpl-73291560-7616-97bf-87f2-7d747bbe84fd","choices":[{"finish_reason":"stop","index":0,"message":{"content":"2+2 equals 4."}}],"object":"chat.completion"}},"error":null}
```

## OpenAI Node.js SDK

您可以通过`content`方法获取Batch任务结果文件内容。

#### 请求示例

```javascript
/**
 * 阿里云百炼 Batch API - 下载结果文件
 * 
 * 若没有配置环境变量，可在代码中硬编码API Key：apiKey: 'sk-xxx'
 * 但不建议在生产环境中直接将API Key硬编码到代码中，以减少API Key泄露风险。
 * 新加坡和北京地域的API Key不同。
 * 
 * 安装依赖：npm install openai
 */
const OpenAI = require('openai');
const fs = require('fs');

// 北京地域配置（默认）
const BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
// 如果使用新加坡地域，请将上面的 BASE_URL 替换为：
// const BASE_URL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
// 注意：切换地域时，API Key也需要对应更换

const apiKey = process.env.DASHSCOPE_API_KEY;
if (!apiKey) {
    console.error('错误: 请设置环境变量 DASHSCOPE_API_KEY');
    console.error('或在代码中设置: const apiKey = "sk-xxx";');
    process.exit(1);
}

const client = new OpenAI({
    apiKey: apiKey,
    baseURL: BASE_URL
});

// 下载结果文件
const content = await client.files.content('file-batch_output-xxx');
const text = await content.text();
console.log(text);

// 保存到本地文件
fs.writeFileSync('result.jsonl', text);
console.log('结果已保存到 result.jsonl');
```

## Java（HTTP）

您可以通过GET请求到`/files/{file_id}/content`端点获取文件内容。

#### 请求示例

```java
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.Scanner;
import java.util.regex.Pattern;
import java.util.regex.Matcher;

/**
 * 阿里云百炼 Batch API - 下载结果文件
 * 
 * 若没有配置环境变量，可在代码中硬编码API Key：API_KEY = "sk-xxx"
 * 但不建议在生产环境中直接将API Key硬编码到代码中，以减少API Key泄露风险。
 * 新加坡和北京地域的API Key不同。
 * 
 * 地域配置：
 * - 北京地域：https://dashscope.aliyuncs.com/compatible-mode/v1
 * - 新加坡地域：https://dashscope-intl.aliyuncs.com/compatible-mode/v1
 * 注意：切换地域时，API Key也需要对应更换
 */
public class BatchAPIDownloadFile {
    
    // 北京地域配置（默认）
    private static final String BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
    // 如果使用新加坡地域，请将上面的 BASE_URL 替换为：
    // private static final String BASE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
    // 注意：切换地域时，API Key也需要对应更换
    
    private static String API_KEY;
    
    public static void main(String[] args) throws Exception {
        API_KEY = System.getenv("DASHSCOPE_API_KEY");
        if (API_KEY == null || API_KEY.isEmpty()) {
            System.err.println("错误: 请设置环境变量 DASHSCOPE_API_KEY");
            System.err.println("或在代码中设置: API_KEY = \"sk-xxx\";");
            System.exit(1);
        }

// 下载结果文件
String content = sendRequest("GET", "/files/file-batch_output-xxx/content", null);
System.out.println(content);

// 保存到本地文件
        Files.write(Paths.get("result.jsonl"), content.getBytes());
        System.out.println("结果已保存到 result.jsonl");
    }
    
    // === 工具方法 ===
    
    private static String sendRequest(String method, String path, String jsonBody) throws Exception {
        URL url = new URL(BASE_URL + path);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod(method);
        conn.setRequestProperty("Authorization", "Bearer " + API_KEY);
        
        if (jsonBody != null) {
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json");
            try (OutputStream os = conn.getOutputStream()) {
                os.write(jsonBody.getBytes("UTF-8"));
            }
        }
        
        return readResponse(conn);
    }
    
    private static String readResponse(HttpURLConnection conn) throws Exception {
        int responseCode = conn.getResponseCode();
        InputStream is = (responseCode < 400) ? conn.getInputStream() : conn.getErrorStream();
        try (Scanner scanner = new Scanner(is, "UTF-8").useDelimiter("\\A")) {
            return scanner.hasNext() ? scanner.next() : "";
        }
    }
    
    private static String parseField(String json, String regex) {
        Pattern pattern = Pattern.compile(regex);
        Matcher matcher = pattern.matcher(json);
        return matcher.find() ? matcher.group(1) : null;
    }
}
```

## curl(HTTP)

您可以通过GET方法，在URL中指定`file_id`来下载Batch任务结果文件。

#### 请求示例

```curl
# ======= 重要提示 =======
# 新加坡和北京地域的API Key不同。
# 以下是北京地域base_url，如果使用新加坡地域的模型，需要将base_url替换为：https://dashscope-intl.aliyuncs.com/compatible-mode/v1/files/file-batch_output-xxx/content
# === 执行时请删除该注释 ===
curl -X GET https://dashscope.aliyuncs.com/compatible-mode/v1/files/file-batch_output-xxx/content \
-H "Authorization: Bearer $DASHSCOPE_API_KEY" > result.jsonl
```

#### **返回示例**

单条响应结果：

```json
{
    "id": "c308ef7f-xxx",
    "custom_id": "1",
    "response": {
        "status_code": 200,
        "request_id": "c308ef7f-0824-9c46-96eb-73566f062426",
        "body": {
            "created": 1742303743,
            "usage": {
                "completion_tokens": 35,
                "prompt_tokens": 26,
                "total_tokens": 61
            },
            "model": "qwen-plus",
            "id": "chatcmpl-c308ef7f-0824-9c46-96eb-73566f062426",
            "choices": [
                {
                    "finish_reason": "stop",
                    "index": 0,
                    "message": {
                        "content": "你好！当然可以。无论是需要信息查询、学习资料、解决问题的方法，还是其他任何帮助，我都在这里为你提供支持。请告诉我你需要什么方面的帮助？"
                    }
                }
            ],
            "object": "chat.completion"
        }
    },
    "error": null
}
```

#### **返回参数**

<table id="8e5965dcff8se" outputclass="table-wide" tablewidth="545" tablecolswidth="127 85 333" autofit="false" class="table-wide table"><colgroup colwidth="0.7*"></colgroup><colgroup colwidth="0.47*"></colgroup><colgroup colwidth="1.84*"></colgroup><tbody class="tbody"><tr id="6ba336d77f0ug"><td id="1c28e21853724" rowspan="1" colspan="1"><p id="9cd9a27a44ht2"><b>字段</b></p></td><td id="099efefd053bq" rowspan="1" colspan="1"><p jc="left" uuid="lzb43i4gnwsvolkn4o" id="f93a1e8e06sqo"><b>类型</b></p></td><td id="39b0765a84r25" rowspan="1" colspan="1"><p jc="left" uuid="lzb43ddyulo1w06kks" id="04916a08d7gqn"><b>描述</b></p></td></tr><tr id="a6fb6deff9ass"><td id="2609eb1fefn2t" rowspan="1" colspan="1"><p jc="left" uuid="lwyqbpl8wv9b800b8y8" id="76a56b7d80ovi">id</p></td><td id="c4a38072d594l" rowspan="1" colspan="1"><p jc="left" uuid="lwyqbpl8t8d3qma154" id="7fd3ae4e13v9o">String</p></td><td id="d0eea6f6b3pd6" rowspan="1" colspan="1"><p jc="left" uuid="lwyqbpl8c7z4jfgew8p" id="5f174a175czjt">请求 ID。</p></td></tr><tr id="66215d23f0d0l"><td id="049aba54e1avy" rowspan="1" colspan="1"><p jc="left" uuid="lwyqbez8f6y028d9vy8" id="c3d9091c0ddzp" left="0">custom_id</p></td><td id="21e6329caa0ji" rowspan="1" colspan="1"><p jc="left" uuid="lwyqbez80zsfo5lnbn4" id="73d3b5241av88" left="0">String</p></td><td id="5e00b155d8n61" rowspan="1" colspan="1"><p jc="left" uuid="lwyqbez8czaaohx2637" id="8ff64e1c8c7y6" left="0">用户自定义的 ID。</p></td></tr><tr id="e8439ecac98z8"><td id="438291dfb23xv" rowspan="1" colspan="1"><p jc="left" uuid="lwyqbez8at05waj34z" id="3e65b9f0f4tmg">response</p></td><td id="304f25303aj8b" rowspan="1" colspan="1"><p jc="left" uuid="lwyqbez8hbfvnalilr6" id="a0abb2c29bx92">Object</p></td><td id="020488f7a9gbv" rowspan="1" colspan="1"><p jc="left" uuid="lwyqbez89kggbgydhjb" id="113116b5f0wxp">请求结果。</p></td></tr><tr id="11cbd0ed49c8v"><td id="e98b553511rtg" rowspan="1" colspan="1"><p id="a0afb2611av2n">status_code</p></td><td id="1c268c7443pga" rowspan="1" colspan="1"><p id="5c6f782555v39">Integer</p></td><td id="4e9c99bffboge" rowspan="1" colspan="1"><p id="45f0bf8926e5j">状态码。200<span class="help-letter-space"></span>表示请求成功。</p></td></tr><tr id="98661c9be8cv4"><td id="c058060a21fdc" rowspan="1" colspan="1"><p jc="left" id="859517da06cc1">request_id</p></td><td id="1857df7cd2wse" rowspan="1" colspan="1"><p id="baf64fc1c1tas">String</p></td><td id="a7cd2c3f47fg4" rowspan="1" colspan="1"><p id="e0a6c7aea4jrj">服务端为这次请求生成的唯一<span class="help-letter-space"></span>ID。</p></td></tr><tr id="80fb7ec193lmc"><td id="b8b693b953do3" rowspan="1" colspan="1"><p id="44d05218c7ejt">completion_tokens</p></td><td id="3aea2252f3je5" rowspan="1" colspan="1"><p id="5c9d6951abdsr">Integer</p></td><td id="d8a58502a2sic" rowspan="1" colspan="1"><p id="4408c06edayog">模型生成的回复内容（completion）所消耗的<span class="help-letter-space"></span>Token<span class="help-letter-space"></span>数量。</p></td></tr><tr id="bc595bd29f2y6"><td id="ea1a9d1e3dpfr" rowspan="1" colspan="1"><p id="70f968e1a8q3f">prompt_tokens</p></td><td id="ce55ccf733628" rowspan="1" colspan="1"><p jc="left" uuid="lwyqbez80zsfo5lnbn4" id="c86c7f1190ri8" left="0">Integer</p></td><td id="cb5a6629d8vxr" rowspan="1" colspan="1"><p id="95ba94232edzw">发送给模型的输入内容（<code data-tag="code" class="code blog-code" id="47b2819e34r2j">prompt</code>）所消耗的<span class="help-letter-space"></span>Token<span class="help-letter-space"></span>数量。</p></td></tr><tr id="6ff342f5ba9q4" props="china" data-cond-props="china"><td id="c7b83272aaa4p" rowspan="1" colspan="1"><p id="cc8873508d1o1">reasoning_tokens</p></td><td id="452749f0b8sh5" rowspan="1" colspan="1"><p jc="left" uuid="lwyqbez80zsfo5lnbn4" id="3e7b1cb531wzj" left="0">Integer</p></td><td id="d4a796cd5blyy" rowspan="1" colspan="1"><p id="b1832b903ecyz">深度思考模型的思考过程<span class="help-letter-space"></span>token<span class="help-letter-space"></span>数。</p></td></tr><tr id="e0007002ed0zk"><td id="2a3e95cf211qc" rowspan="1" colspan="1"><p id="8a2078aeab4x7">total_tokens</p></td><td id="1eb7c46c48qbx" rowspan="1" colspan="1"><p id="1cf127ed9fvw0">Integer</p></td><td id="3b726a5df5vug" rowspan="1" colspan="1"><p id="05859dcf494ds">本次调用总共消耗的<span class="help-letter-space"></span>Token<span class="help-letter-space"></span>数量。</p></td></tr><tr id="38e36311c6my1"><td id="8f848ede84dm5" rowspan="1" colspan="1"><p id="65e8360c3boyx">model</p></td><td id="71eb23348eexv" rowspan="1" colspan="1"><p jc="left" uuid="lwyqbez80zsfo5lnbn4" id="440962372d6v4" left="0">String</p></td><td id="82550dcf7f2dx" rowspan="1" colspan="1"><p id="d51e8c4f80h6h">本次调用所使用的模型名称。</p></td></tr><tr id="63a3d0da3707d" props="china" data-cond-props="china"><td id="2fd9932e01ije" rowspan="1" colspan="1"><p id="1d22f3413b1cu">reasoning_content</p></td><td id="387b16c3a9g4n" rowspan="1" colspan="1"><p jc="left" uuid="lwyqbez80zsfo5lnbn4" id="b9a4e0c0aaxq3" left="0">String</p></td><td id="fb35b8c805rpl" rowspan="1" colspan="1"><p id="c94f4389f6rst">深度思考模型的思考过程。</p></td></tr><tr id="900f96d0adcv9"><td id="ed9826823f8b8" rowspan="1" colspan="1"><p jc="left" uuid="lwyqbez8hhrf9hnimpp" id="13ca7b2472pi8">error</p></td><td id="8e01552bdchh8" rowspan="1" colspan="1"><p jc="left" uuid="lwyqbez8qovchmfc11o" id="13d4ed9565gpf">Object</p></td><td id="d4c52f7b37iqc" rowspan="1" colspan="1"><p jc="left" uuid="lwyqbez8gu5um3znmlq" id="ff6f15cfe7oc7">错误信息对象。如果<span class="help-letter-space"></span>API<span class="help-letter-space"></span>调用成功，该值为<code data-tag="code" class="code blog-code" id="5a4a6663bfbic">null</code>。如果发生错误，这里会包含错误代码和详细的错误信息。</p></td></tr><tr id="5453bc1b73wyf"><td id="1515822b251cs" rowspan="1" colspan="1"><p jc="left" uuid="lwyqbez8hhrf9hnimpp" id="9b58882b10r96">error.code</p></td><td id="50c392205frsi" rowspan="1" colspan="1"><p jc="left" uuid="lwyqbez80zsfo5lnbn4" id="06a4ebb9b5mvy" left="0">String</p></td><td id="87a944d4bdyuo" rowspan="1" colspan="1"><p jc="left" id="309c924fe0mvx">错误行信息和错误原因，可参考<a href="#97e145aeabbwf" id="1fc52c89dfjvv" title="" class="xref">错误码</a>进行排查。</p></td></tr><tr id="4f0055a31aa75"><td id="5f5a906a8dntd" rowspan="1" colspan="1"><p jc="left" uuid="lwyqbez8hhrf9hnimpp" id="548cae6df74c9">error.message</p></td><td id="81e92eced6r5l" rowspan="1" colspan="1"><p jc="left" uuid="lwyqbez80zsfo5lnbn4" id="afc938392fl2s" left="0">String</p></td><td id="41054ecaf7vnr" rowspan="1" colspan="1"><p jc="left" id="188d91b1b73uv">错误信息。</p></td></tr></tbody></table>

## **进阶功能**

### **使用 OSS 文件创建 Batch 任务**

对于大型文件，推荐将其存储在阿里云 OSS 中，并通过 `input_file_id` 直接引用，以避免本地上传的限制。

**方式一：使用文件 URL**

将具有公共读权限或预签名授权的 OSS 文件 URL 直接作为 `input_file_id`：

```python
batch_job = client.batches.create(
    input_file_id="https://your-bucket.oss-cn-beijing.aliyuncs.com/file.jsonl?Expires=...",
    endpoint="/v1/chat/completions",
    completion_window="24h"
)
```

**方式二：使用资源标识符（推荐）**

1.  **完成 OSS 授权**
    
    参阅[从OSS导入文件配置说明](https://help.aliyun.com/zh/model-studio/data-import-instructions#a2b61704136bj)的授权和添加标签步骤。
    
2.  **参数配置**
    
    使用`oss:{region}:{bucket}/{file_path}`格式的 OSS 资源标识符：
    
    ```python
    batch_job = client.batches.create(
        input_file_id="oss:cn-beijing:your-bucket/path/to/file.jsonl",
        endpoint="/v1/chat/completions",
        completion_window="24h"
    )
    ```
    

**建议**：

### **配置任务完成通知**

对于长时间运行的任务，轮询会消耗不必要的资源。建议使用异步通知机制，系统会在任务完成后主动通知。

#### **方式一：Callback 回调**

在创建任务时通过 `metadata` 指定一个公网可访问的 URL。任务完成后，系统会向指定 URL 发送包含任务状态的 POST 请求：

## OpenAI Python SDK

```python
import os
from openai import OpenAI

client = OpenAI(
    # 若没有配置环境变量，可用阿里云百炼API Key将下行替换为：api_key="sk-xxx"。但不建议在生产环境中直接将API Key硬编码到代码中，以减少API Key泄露风险。
    # 新加坡和北京地域的API Key不同。
    api_key=os.getenv("DASHSCOPE_API_KEY"), 
    # 以下是北京地域base_url，如果使用新加坡地域的模型，需要将base_url替换为：https://dashscope-intl.aliyuncs.com/compatible-mode/v1
    # 注意：切换地域时，API Key也需要对应更换
    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
)

batch = client.batches.create(
    input_file_id="file-batch-xxx",  # 上传文件返回的 id
    endpoint="/v1/chat/completions",  # Embedding文本向量模型填写"/v1/embeddings",测试模型batch-test-model填写/v1/chat/ds-test,其他模型填写/v1/chat/completions
    completion_window="24h", 
    metadata={
            "ds_batch_finish_callback": "https://xxx/xxx"
          }
)
print(batch)
```

## curl(HTTP)

#### **请求示例**

```curl
curl -X POST --location "https://dashscope.aliyuncs.com/compatible-mode/v1/batches" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
          "input_file_id": "file-batch-xxxxx",
          "endpoint": "/v1/chat/completions",
          "completion_window": "24h",
          "metadata": {
            "ds_batch_finish_callback": "https://xxx/xxx"
          }
        }'
```

## **应用于生产环境**

### **实用工具**

#### **CSV 转 JSONL**

如果原始数据存储在 CSV 文件中（第一列为 ID，第二列为内容），可使用以下脚本快速生成 Batch 任务所需的 JSONL 文件。

> 如需调整文件路径或其他参数，请根据实际情况修改代码。

```python
import csv
import json
def messages_builder_example(content):
    messages = [{"role": "system", "content": "You are a helpful assistant."}, {"role": "user", "content": content}]
    return messages

with open("input_demo.csv", "r") as fin:
    with open("input_demo.jsonl", 'w', encoding='utf-8') as fout:
        csvreader = csv.reader(fin)
        for row in csvreader:
            body = {"model": "qwen-turbo", "messages": messages_builder_example(row[1])}
            # 选择Embedding文本向量模型进行调用时，url的值需填写"/v1/embeddings",其他模型填写/v1/chat/completions
            request = {"custom_id": row[0], "method": "POST", "url": "/v1/chat/completions", "body": body}
            fout.write(json.dumps(request, separators=(',', ':'), ensure_ascii=False) + "\n")
```

#### JSONL 结果转 CSV

使用以下脚本可将 `result.jsonl` 文件解析为易于在 Excel 中分析的 `result.csv` 文件。

> 如需调整文件路径或其他参数，请根据实际情况修改代码。

```python
import json
import csv
columns = ["custom_id",
           "model",
           "request_id",
           "status_code",
           "error_code",
           "error_message",
           "created",
           "content",
           "usage"]

def dict_get_string(dict_obj, path):
    obj = dict_obj
    try:
        for element in path:
            obj = obj[element]
        return obj
    except:
        return None

with open("result.jsonl", "r") as fin:
    with open("result.csv", 'w', encoding='utf-8') as fout:
        rows = [columns]
        for line in fin:
            request_result = json.loads(line)
            row = [dict_get_string(request_result, ["custom_id"]),
                   dict_get_string(request_result, ["response", "body", "model"]),
                   dict_get_string(request_result, ["response", "request_id"]),
                   dict_get_string(request_result, ["response", "status_code"]),
                   dict_get_string(request_result, ["error", "error_code"]),
                   dict_get_string(request_result, ["error", "error_message"]),
                   dict_get_string(request_result, ["response", "body", "created"]),
                   dict_get_string(request_result, ["response", "body", "choices", 0, "message", "content"]),
                   dict_get_string(request_result, ["response", "body", "usage"])]
            rows.append(row)
        writer = csv.writer(fout)
        writer.writerows(rows)
```

**Excel 乱码解决**

## **接口限流**

<table id="6290e2c13fr16" outputclass="table-wide" tablewidth="627" tablecolswidth="251 376" autofit="false" class="table-wide table"><colgroup colwidth="0.8*"></colgroup><colgroup colwidth="1.2*"></colgroup><tbody class="tbody"><tr id="fe4b2170a6gmk"><td id="f53458159ez53" rowspan="1" colspan="1"><p jc="left" id="2ca35e4f10kk3"><b>接口</b></p></td><td id="8efe49df8f5o7" rowspan="1" colspan="1"><p jc="left" id="ea98720fa4i62"><b>限流（主账号级别）</b></p></td></tr><tr id="f88ccb5eb1n99"><td id="a8a63ba971ip7" rowspan="1" colspan="1"><p jc="left" id="ea86d2e9b67j8">创建任务</p></td><td id="9d3be55b62gc2" rowspan="1" colspan="1"><p jc="left" id="49409f4c59cq3">1000 次/分钟，最大并发 1000 个</p></td></tr><tr id="1606fd05b1yno"><td id="f8ec25ef64plh" rowspan="1" colspan="1"><p jc="left" id="7e832e8d29hyu">查询任务</p></td><td id="20033684edprv" rowspan="1" colspan="1"><p jc="left" id="032652eb14bvd">1000 次/分钟</p></td></tr><tr id="70ffd384befn6"><td id="48a1c80fde10q" rowspan="1" colspan="1"><p jc="left" id="8c0b8af5a4feh">查询任务列表</p></td><td id="6e859bad14kcz" rowspan="1" colspan="1"><p jc="left" id="185aca996067g">100 次/分钟</p></td></tr><tr id="7bd746202afdp"><td id="f956f9d830rip" rowspan="1" colspan="1"><p jc="left" id="03ef901fe4agy">取消任务</p></td><td id="8b48c8c616oek" rowspan="1" colspan="1"><p jc="left" id="ee977e34abfll">1000 次/分钟</p></td></tr></tbody></table>

## **计费说明**

## 错误码

如果调用失败并返回报错信息，请参见[错误信息](https://help.aliyun.com/zh/model-studio/error-code)进行解决。

## **常见问题**

1.  **如何选择使用 Batch Chat 还是Batch File？**
    
    当需要处理的是包含大量请求的单个大文件，并且可以接受异步获取结果文件，选择 Batch File。当业务逻辑需要以 API 同步调用的方式、高并发地提交大量独立的对话请求时，则选择 Batch Chat。
    
2.  **Batch File调用如何计费？需要单独购买吗？**
    
    答：Batch是一种调用方式，采用后付费模式，根据任务中成功请求的Token使用量计费，无需额外购买套餐。
    
3.  **提交的Batch File是按顺序执行的吗？**
    
    答：不是。后台采用动态调度机制，系统会根据当前整体的计算资源负载来安排任务执行，不保证严格遵循提交顺序。在资源紧张时，任务启动和执行可能会有延迟。
    
4.  **提交的Batch File需要多长时间完成？**
    
    答：执行时间取决于系统资源分配情况和您的任务规模。若任务在您设定的 completion\_window内未能完成，其状态将变为expired，此时未处理的请求将不会再执行，也不会产生费用。
    
    **场景建议：**对模型推理时效性有严格要求的场景，建议使用实时调用；对于处理大规模数据且对时效性有一定容忍度的场景，推荐使用Batch调用。