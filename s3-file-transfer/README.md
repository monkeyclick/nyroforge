# S3 File Transfer Application

A comprehensive, enterprise-grade file transfer solution for Amazon S3 with multipart upload/download support, drag-and-drop interface, progress tracking, checksum verification, and robust error handling.

## Features

### Core Functionality
- **Multipart Upload/Download**: Efficiently transfer large files using AWS S3 multipart upload API
- **Drag-and-Drop Interface**: Intuitive file selection with drag-and-drop support
- **Progress Tracking**: Real-time progress bars with speed and ETA calculations
- **Checksum Verification**: MD5 and SHA256 hash verification for data integrity
- **Error Handling**: Automatic retry with exponential backoff
- **Transfer Queue**: Manage multiple concurrent transfers with priorities

### Security
- **AWS Credentials Management**: Secure credential storage with multiple profile support
- **IAM Role Support**: Support for instance roles and assumed roles
- **Encryption**: Support for SSE-S3, SSE-KMS, and client-side encryption
- **Secure Storage**: Credentials stored securely in browser local storage

### User Interface
- **S3 Browser**: Navigate buckets and objects with folder hierarchy
- **Transfer History**: View completed transfers with download logs
- **Bucket Management**: Create and manage S3 buckets
- **Dark Mode**: Toggle between light and dark themes

## Quick Start

### Prerequisites
- Node.js 18+ and npm
- AWS Account with S3 access
- IAM user or role with appropriate permissions

### Installation

```bash
# Clone or navigate to the project
cd s3-file-transfer

# Install dependencies
npm install

# Start development server
npm run dev
```

### Build for Production

```bash
# Create production build
npm run build

# Preview production build
npm run preview
```

## Project Structure

```
s3-file-transfer/
├── src/
│   ├── components/
│   │   ├── App.tsx              # Main application component
│   │   ├── S3Browser.tsx        # S3 bucket/object browser
│   │   ├── UploadDropzone.tsx   # Drag-drop upload interface
│   │   ├── TransferList.tsx     # Active transfers display
│   │   ├── CredentialManager.tsx # AWS credentials modal
│   │   └── BucketSelector.tsx   # Bucket selection dropdown
│   ├── services/
│   │   ├── s3Service.ts         # S3 API operations
│   │   ├── checksumService.ts   # MD5/SHA256 calculations
│   │   ├── transferQueue.ts     # Transfer queue management
│   │   └── credentialManager.ts # Credential storage
│   ├── stores/
│   │   └── transferStore.ts     # Zustand global state
│   ├── types/
│   │   └── index.ts             # TypeScript definitions
│   ├── utils/
│   │   └── formatters.ts        # Utility functions
│   ├── main.tsx                 # Application entry point
│   └── index.css                # Global styles
├── terraform/
│   ├── main.tf                  # Infrastructure configuration
│   ├── variables.tf             # Input variables
│   └── outputs.tf               # Output values
├── package.json
├── vite.config.ts
├── tailwind.config.js
└── tsconfig.json
```

## Configuration

### Environment Variables

Create a `.env` file for local development:

```env
# Optional: Default AWS region
VITE_AWS_REGION=us-east-1

# Optional: Default bucket
VITE_DEFAULT_BUCKET=my-bucket

# Optional: API endpoint for server-side operations
VITE_API_ENDPOINT=https://api.example.com
```

### Transfer Settings

Configure transfer behavior in `src/services/transferQueue.ts`:

```typescript
const DEFAULT_CONFIG = {
  maxConcurrent: 3,           // Max concurrent transfers
  chunkSize: 5 * 1024 * 1024, // Multipart chunk size (5MB)
  maxRetries: 3,              // Max retry attempts
  retryDelayMs: 1000,         // Initial retry delay
};
```

## Usage Guide

### Connecting to AWS

1. Click the **Key** icon in the header or navigate to Settings
2. Choose authentication method:
   - **Access Keys**: Enter Access Key ID and Secret Access Key
   - **IAM Role**: For EC2 instances or ECS tasks with attached roles
3. Select your AWS region
4. Click **Test Connection** to verify credentials
5. Click **Connect** to save and connect

### Uploading Files

1. Select a bucket from the dropdown
2. Navigate to your target folder (or create one)
3. Either:
   - Drag files into the upload dropzone
   - Click the dropzone to open file picker
4. Monitor progress in the Transfers tab
5. View completed uploads in Transfer History

### Downloading Files

1. Navigate to the file in S3 Browser
2. Click the download icon or right-click and select "Download"
3. Monitor progress in the Transfers tab
4. Files are saved to your browser's download location

### Managing Transfers

- **Pause/Resume**: Click pause button on active transfer
- **Cancel**: Click X to cancel a transfer
- **Retry**: Failed transfers can be retried
- **Clear History**: Remove completed transfers from history

## Infrastructure Deployment

### Terraform Setup

Deploy the AWS infrastructure for production use:

```bash
cd terraform

# Initialize Terraform
terraform init

# Preview changes
terraform plan -var="environment=prod"

# Apply configuration
terraform apply -var="environment=prod"
```

### Infrastructure Options

```hcl
# terraform.tfvars
project_name    = "s3-transfer"
environment     = "prod"
aws_region      = "us-east-1"

# S3 Configuration
enable_versioning     = true
enable_access_logging = true

# Security
create_kms_key  = true
create_iam_user = true

# CloudFront (optional CDN)
enable_cloudfront = true
cloudfront_price_class = "PriceClass_100"

# Monitoring
enable_cloudwatch_alarms       = true
bucket_size_alarm_threshold_gb = 500
```

### IAM Permissions

Required permissions for the application:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket",
        "s3:GetBucketLocation",
        "s3:GetBucketVersioning"
      ],
      "Resource": "arn:aws:s3:::your-bucket"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListMultipartUploadParts",
        "s3:AbortMultipartUpload"
      ],
      "Resource": "arn:aws:s3:::your-bucket/*"
    }
  ]
}
```

## API Reference

### S3 Service

```typescript
import { s3Service } from './services/s3Service';

// Configure credentials
await s3Service.configure({
  region: 'us-east-1',
  accessKeyId: 'AKIA...',
  secretAccessKey: '...',
});

// List buckets
const buckets = await s3Service.listBuckets();

// List objects
const objects = await s3Service.listObjects(bucket, prefix);

// Upload file
const result = await s3Service.uploadFile(file, bucket, key, {
  onProgress: (progress) => console.log(progress),
  checksumAlgorithm: 'SHA256',
});

// Download file
const blob = await s3Service.downloadFile(bucket, key, {
  onProgress: (progress) => console.log(progress),
});
```

### Transfer Queue

```typescript
import { transferQueue } from './services/transferQueue';

// Add upload
const transferId = await transferQueue.addUpload(file, bucket, key);

// Add download
const transferId = await transferQueue.addDownload(bucket, key);

// Pause transfer
transferQueue.pause(transferId);

// Resume transfer
transferQueue.resume(transferId);

// Cancel transfer
transferQueue.cancel(transferId);

// Event listeners
transferQueue.on('progress', (transfer) => { ... });
transferQueue.on('completed', (transfer) => { ... });
transferQueue.on('error', (transfer, error) => { ... });
```

### Checksum Service

```typescript
import { checksumService } from './services/checksumService';

// Calculate MD5
const md5 = await checksumService.calculateMD5(file);

// Calculate SHA256
const sha256 = await checksumService.calculateSHA256(file);

// Verify integrity
const isValid = await checksumService.verify(file, expectedHash, 'sha256');
```

## Browser Compatibility

| Browser | Version | Status |
|---------|---------|--------|
| Chrome  | 90+     | ✅ Full Support |
| Firefox | 88+     | ✅ Full Support |
| Safari  | 14+     | ✅ Full Support |
| Edge    | 90+     | ✅ Full Support |

### Required Browser APIs
- File API
- Streams API
- Web Crypto API
- Fetch API

## Performance Optimization

### Large File Uploads
- Files larger than 5MB use multipart upload
- Chunk size adjusts based on file size
- Maximum 10,000 parts per upload

### Concurrent Transfers
- Default: 3 concurrent transfers
- Adjust based on network bandwidth
- Queue system prevents overload

### Memory Management
- Streaming uploads for large files
- Chunked downloads with Blob assembly
- Automatic cleanup of completed transfers

## Troubleshooting

### Common Issues

**CORS Errors**
```
Ensure your S3 bucket has proper CORS configuration:
- AllowedOrigins: ["*"] or your domain
- AllowedMethods: ["GET", "PUT", "POST", "DELETE", "HEAD"]
- AllowedHeaders: ["*"]
```

**Access Denied**
```
Verify IAM permissions include:
- s3:ListBucket on bucket ARN
- s3:GetObject/PutObject on bucket/* ARN
```

**Multipart Upload Failures**
```
Check AbortMultipartUpload permission
Lifecycle rule cleans up incomplete uploads after 7 days
```

### Debug Mode

Enable debug logging:
```typescript
localStorage.setItem('s3_transfer_debug', 'true');
```

View logs in browser console with `[S3Transfer]` prefix.

## Security Considerations

1. **Never commit credentials** - Use environment variables or credential files
2. **Use HTTPS** - All S3 connections should use HTTPS
3. **Principle of least privilege** - Grant minimum required IAM permissions
4. **Enable bucket versioning** - Protect against accidental deletions
5. **Use KMS encryption** - For sensitive data at rest
6. **Enable access logging** - Monitor bucket access patterns

## Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## License

MIT License - see LICENSE file for details.

## Support

- **Issues**: GitHub Issues for bug reports
- **Documentation**: This README and inline code comments
- **AWS Documentation**: [S3 Developer Guide](https://docs.aws.amazon.com/s3/)