//------------------------------------------------------------------------------
// Upload Dropzone Component - Drag & Drop File Upload
//------------------------------------------------------------------------------

import React, { useCallback, useState } from 'react';
import { useDropzone, FileRejection } from 'react-dropzone';
import {
  Upload,
  FolderUp,
  X,
  File,
  Folder,
  Settings,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useTransferStore } from '../stores/transferStore';
import { StorageClass, EncryptionConfig } from '../types';
import { formatBytes, getStorageClassDisplayName } from '../utils/formatters';

interface UploadDropzoneProps {
  className?: string;
}

interface PendingUpload {
  file: File;
  relativePath: string;
}

export const UploadDropzone: React.FC<UploadDropzoneProps> = ({ className = '' }) => {
  const { selectedBucket, s3CurrentPrefix, uploadFiles, settings } = useTransferStore();

  const [pendingFiles, setPendingFiles] = useState<PendingUpload[]>([]);
  const [showOptions, setShowOptions] = useState(false);
  const [storageClass, setStorageClass] = useState<StorageClass>(settings.defaultStorageClass);
  const [encryptionType, setEncryptionType] = useState<EncryptionConfig['type']>(
    settings.defaultEncryption.type
  );
  const [kmsKeyId, setKmsKeyId] = useState<string>('');
  const [customPrefix, setCustomPrefix] = useState<string>('');

  // Handle dropped files
  const onDrop = useCallback(
    (acceptedFiles: File[], rejectedFiles: FileRejection[]) => {
      const newFiles = acceptedFiles.map((file) => ({
        file,
        relativePath: (file as any).webkitRelativePath || file.name,
      }));
      setPendingFiles((prev) => [...prev, ...newFiles]);

      // Log rejected files
      if (rejectedFiles.length > 0) {
        console.warn('Rejected files:', rejectedFiles);
      }
    },
    []
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    noClick: pendingFiles.length > 0,
    noKeyboard: true,
  });

  // Remove file from pending list
  const removeFile = (index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  };

  // Clear all pending files
  const clearFiles = () => {
    setPendingFiles([]);
  };

  // Start upload
  const handleUpload = () => {
    if (!selectedBucket || pendingFiles.length === 0) return;

    const files = pendingFiles.map((p) => p.file);
    const keyPrefix = customPrefix || s3CurrentPrefix;

    uploadFiles(files, {
      keyPrefix,
      storageClass,
      encryption: {
        type: encryptionType,
        kmsKeyId: encryptionType === 'SSE-KMS' ? kmsKeyId : undefined,
      },
    });

    // Clear pending files after starting upload
    setPendingFiles([]);
  };

  // Handle folder selection
  const handleFolderSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newFiles = Array.from(files).map((file) => ({
      file,
      relativePath: (file as any).webkitRelativePath || file.name,
    }));
    setPendingFiles((prev) => [...prev, ...newFiles]);
    e.target.value = ''; // Reset input
  };

  // Calculate total size
  const totalSize = pendingFiles.reduce((sum, p) => sum + p.file.size, 0);

  if (!selectedBucket) {
    return (
      <div className={`flex items-center justify-center p-8 border-2 border-dashed border-gray-300 rounded-lg ${className}`}>
        <div className="text-center text-gray-500">
          <Upload className="w-12 h-12 mx-auto mb-2 opacity-50" />
          <p>Select a bucket first to upload files</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col ${className}`}>
      {/* Dropzone Area */}
      <div
        {...getRootProps()}
        className={`
          p-6 border-2 border-dashed rounded-lg transition-colors cursor-pointer
          ${isDragActive
            ? 'border-primary-500 bg-primary-50'
            : 'border-gray-300 hover:border-primary-400 hover:bg-gray-50'
          }
          ${pendingFiles.length > 0 ? 'pb-2' : ''}
        `}
      >
        <input {...getInputProps()} />
        
        {pendingFiles.length === 0 ? (
          <div className="text-center">
            <Upload
              className={`w-12 h-12 mx-auto mb-3 ${
                isDragActive ? 'text-primary-500' : 'text-gray-400'
              }`}
            />
            <p className="text-lg font-medium text-gray-700 mb-1">
              {isDragActive ? 'Drop files here' : 'Drag & drop files here'}
            </p>
            <p className="text-sm text-gray-500 mb-4">or click to browse</p>
            
            <div className="flex justify-center gap-3">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  open();
                }}
                className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 flex items-center gap-2"
              >
                <File className="w-4 h-4" />
                Select Files
              </button>
              
              <label
                onClick={(e) => e.stopPropagation()}
                className="px-4 py-2 text-sm bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 cursor-pointer flex items-center gap-2"
              >
                <FolderUp className="w-4 h-4" />
                Select Folder
                <input
                  type="file"
                  // @ts-ignore - webkitdirectory is not in standard types
                  webkitdirectory=""
                  directory=""
                  multiple
                  onChange={handleFolderSelect}
                  className="hidden"
                />
              </label>
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Upload className="w-5 h-5 text-primary-600" />
                <span className="font-medium text-gray-700">
                  {pendingFiles.length} file{pendingFiles.length !== 1 ? 's' : ''} selected
                </span>
                <span className="text-sm text-gray-500">({formatBytes(totalSize)})</span>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  clearFiles();
                }}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                Clear all
              </button>
            </div>
            
            {/* File list */}
            <div className="max-h-48 overflow-y-auto space-y-1 mb-3">
              {pendingFiles.map((p, index) => (
                <div
                  key={`${p.file.name}-${index}`}
                  className="flex items-center justify-between p-2 bg-gray-50 rounded"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    {p.relativePath.includes('/') ? (
                      <Folder className="w-4 h-4 text-yellow-500 flex-shrink-0" />
                    ) : (
                      <File className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    )}
                    <span className="text-sm truncate">{p.relativePath}</span>
                    <span className="text-xs text-gray-500 flex-shrink-0">
                      {formatBytes(p.file.size)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeFile(index)}
                    className="p-1 text-gray-400 hover:text-gray-600"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            {/* Add more files hint */}
            <p className="text-xs text-center text-gray-500">
              Drop more files or click to add
            </p>
          </div>
        )}
      </div>

      {/* Upload Options */}
      {pendingFiles.length > 0 && (
        <div className="mt-4 border rounded-lg">
          <button
            type="button"
            onClick={() => setShowOptions(!showOptions)}
            className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50"
          >
            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4 text-gray-500" />
              <span className="text-sm font-medium text-gray-700">Upload Options</span>
            </div>
            {showOptions ? (
              <ChevronUp className="w-4 h-4 text-gray-500" />
            ) : (
              <ChevronDown className="w-4 h-4 text-gray-500" />
            )}
          </button>

          {showOptions && (
            <div className="px-4 pb-4 space-y-4 border-t">
              {/* Destination Prefix */}
              <div className="pt-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Destination Path
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-500">s3://{selectedBucket}/</span>
                  <input
                    type="text"
                    value={customPrefix || s3CurrentPrefix}
                    onChange={(e) => setCustomPrefix(e.target.value)}
                    placeholder={s3CurrentPrefix || 'Enter prefix'}
                    className="flex-1 px-3 py-1.5 text-sm border rounded focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
              </div>

              {/* Storage Class */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Storage Class
                </label>
                <select
                  value={storageClass}
                  onChange={(e) => setStorageClass(e.target.value as StorageClass)}
                  className="w-full px-3 py-2 text-sm border rounded focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="STANDARD">{getStorageClassDisplayName('STANDARD')}</option>
                  <option value="STANDARD_IA">{getStorageClassDisplayName('STANDARD_IA')}</option>
                  <option value="ONEZONE_IA">{getStorageClassDisplayName('ONEZONE_IA')}</option>
                  <option value="INTELLIGENT_TIERING">
                    {getStorageClassDisplayName('INTELLIGENT_TIERING')}
                  </option>
                  <option value="GLACIER">{getStorageClassDisplayName('GLACIER')}</option>
                  <option value="GLACIER_IR">{getStorageClassDisplayName('GLACIER_IR')}</option>
                  <option value="DEEP_ARCHIVE">{getStorageClassDisplayName('DEEP_ARCHIVE')}</option>
                </select>
              </div>

              {/* Encryption */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Server-Side Encryption
                </label>
                <select
                  value={encryptionType}
                  onChange={(e) => setEncryptionType(e.target.value as EncryptionConfig['type'])}
                  className="w-full px-3 py-2 text-sm border rounded focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="none">None</option>
                  <option value="SSE-S3">SSE-S3 (AES-256)</option>
                  <option value="SSE-KMS">SSE-KMS</option>
                </select>
              </div>

              {/* KMS Key ID */}
              {encryptionType === 'SSE-KMS' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    KMS Key ID
                  </label>
                  <input
                    type="text"
                    value={kmsKeyId}
                    onChange={(e) => setKmsKeyId(e.target.value)}
                    placeholder="alias/my-key or key ARN"
                    className="w-full px-3 py-2 text-sm border rounded focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Leave empty to use the default S3 KMS key
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Upload Button */}
      {pendingFiles.length > 0 && (
        <div className="mt-4 flex justify-end gap-3">
          <button
            type="button"
            onClick={clearFiles}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleUpload}
            className="px-6 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 flex items-center gap-2"
          >
            <Upload className="w-4 h-4" />
            Upload {pendingFiles.length} file{pendingFiles.length !== 1 ? 's' : ''}
          </button>
        </div>
      )}
    </div>
  );
};

export default UploadDropzone;