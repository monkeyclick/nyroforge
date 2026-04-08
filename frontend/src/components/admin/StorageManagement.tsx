import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchAuthSession } from 'aws-amplify/auth';

interface StorageSystem {
  id: string;
  name: string;
  type: 'efs' | 'fsx-windows' | 'fsx-lustre' | 'fsx-ontap' | 'fsx-openzfs' | 's3';
  status: 'deployed' | 'not-deployed' | 'deploying';
  description: string;
  estimatedCost?: string;
  features: string[];
}

interface S3Object {
  key: string;
  size: number;
  lastModified: string;
  storageClass?: string;
  isFolder?: boolean;
}

interface StorageStats {
  totalObjects: number;
  totalSize: number;
  bucketName: string;
  efsId?: string;
  efsStatus?: string;
}

interface UploadProgress {
  file: string;
  progress: number;
  status: 'pending' | 'uploading' | 'completed' | 'error';
  error?: string;
}

const STORAGE_SYSTEMS: StorageSystem[] = [
  {
    id: 'efs',
    name: 'Amazon EFS',
    type: 'efs',
    status: 'deployed',
    description: 'Elastic File System - Scalable NFS storage for Linux workloads',
    estimatedCost: '~$0.30/GB-month',
    features: ['NFS v4.1', 'Auto-scaling', 'Multi-AZ', 'Lifecycle policies'],
  },
  {
    id: 's3-transfer',
    name: 'S3 Transfer Bucket',
    type: 's3',
    status: 'deployed',
    description: 'Object storage for file transfers and temporary storage',
    estimatedCost: '~$0.023/GB-month',
    features: ['Versioning', 'KMS encryption', 'CORS enabled', 'Presigned URLs'],
  },
  {
    id: 'fsx-windows',
    name: 'FSx for Windows',
    type: 'fsx-windows',
    status: 'not-deployed',
    description: 'Fully managed Windows file system with SMB support',
    estimatedCost: '~$0.13/GB-month + throughput',
    features: ['Active Directory', 'SMB 3.0', 'Data deduplication', 'Shadow copies'],
  },
  {
    id: 'fsx-lustre',
    name: 'FSx for Lustre',
    type: 'fsx-lustre',
    status: 'not-deployed',
    description: 'High-performance parallel file system for HPC and media workloads',
    estimatedCost: '~$0.14/GB-month',
    features: ['S3 integration', 'Sub-millisecond latency', 'Up to 100s GB/s throughput', 'POSIX compliant'],
  },
  {
    id: 'fsx-ontap',
    name: 'FSx for NetApp ONTAP',
    type: 'fsx-ontap',
    status: 'not-deployed',
    description: 'Multi-protocol storage with NetApp features',
    estimatedCost: '~$0.05/GB-month + SSD cache',
    features: ['NFS, SMB, iSCSI', 'SnapMirror', 'FlexClone', 'Data tiering'],
  },
  {
    id: 'fsx-openzfs',
    name: 'FSx for OpenZFS',
    type: 'fsx-openzfs',
    status: 'not-deployed',
    description: 'ZFS-powered file system with advanced data management',
    estimatedCost: '~$0.09/GB-month',
    features: ['Snapshots', 'Compression', 'NFS v3/v4', 'Data cloning'],
  },
];

export default function StorageManagement() {
  const [activeSubTab, setActiveSubTab] = useState<'browser' | 'upload' | 'deploy' | 'settings'>('browser');
  const [currentPath, setCurrentPath] = useState('');
  const [objects, setObjects] = useState<S3Object[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [uploads, setUploads] = useState<UploadProgress[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [storageSystems, setStorageSystems] = useState<StorageSystem[]>(STORAGE_SYSTEMS);
  const [deployingSystem, setDeployingSystem] = useState<string | null>(null);
  const [deletingSystem, setDeletingSystem] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deployedFileSystems, setDeployedFileSystems] = useState<any[]>([]);
  const [loadingFileSystems, setLoadingFileSystems] = useState(false);
  
  // Storage configuration from SSM (would be fetched from backend)
  const [storageConfig, setStorageConfig] = useState({
    transferBucket: '',
    efsFileSystemId: '',
    efsAccessPointId: '',
    region: 'us-east-1',
  });

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleString();
  };

  const getFileIcon = (key: string, isFolder?: boolean): string => {
    if (isFolder) return '📁';
    const ext = key.split('.').pop()?.toLowerCase();
    const icons: Record<string, string> = {
      pdf: '📄',
      doc: '📝', docx: '📝',
      xls: '📊', xlsx: '📊',
      ppt: '📽️', pptx: '📽️',
      jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', svg: '🖼️',
      mp3: '🎵', wav: '🎵', flac: '🎵',
      mp4: '🎬', avi: '🎬', mov: '🎬', mkv: '🎬',
      zip: '📦', rar: '📦', '7z': '📦', tar: '📦', gz: '📦',
      js: '📜', ts: '📜', py: '📜', java: '📜', cpp: '📜', c: '📜',
      html: '🌐', css: '🎨', json: '📋', xml: '📋',
      txt: '📃', md: '📃',
      exe: '⚙️', msi: '⚙️', dmg: '⚙️',
    };
    return icons[ext || ''] || '📄';
  };

  const fetchStorageConfig = useCallback(async () => {
    try {
      const session = await fetchAuthSession();
      const token = session.tokens?.idToken?.toString();
      
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_ENDPOINT}/admin/storage/config`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      
      if (response.ok) {
        const data = await response.json();
        setStorageConfig(data);
      }
    } catch (err) {
      console.error('Failed to fetch storage config:', err);
    }
  }, []);

  const fetchObjects = useCallback(async (prefix: string = '') => {
    setIsLoading(true);
    setError(null);
    
    try {
      const session = await fetchAuthSession();
      const token = session.tokens?.idToken?.toString();
      
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_ENDPOINT}/admin/storage/list?prefix=${encodeURIComponent(prefix)}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        }
      );
      
      if (!response.ok) {
        throw new Error(`Failed to list objects: ${response.statusText}`);
      }
      
      const data = await response.json();
      setObjects(data.objects || []);
      setStats(data.stats || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load storage');
      setObjects([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetch deployed file systems
  const fetchFileSystems = useCallback(async () => {
    setLoadingFileSystems(true);
    try {
      const session = await fetchAuthSession();
      const token = session.tokens?.idToken?.toString();
      
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_ENDPOINT}/admin/storage/filesystems`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      
      if (response.ok) {
        const data = await response.json();
        setDeployedFileSystems(data.fileSystems || []);
        
        // Update storage systems status based on deployed file systems
        setStorageSystems(prev => prev.map(system => {
          const deployed = data.fileSystems?.find((fs: any) => fs.type === system.type);
          if (deployed) {
            return { ...system, status: 'deployed' as const };
          }
          return system;
        }));
      }
    } catch (err) {
      console.error('Failed to fetch file systems:', err);
    } finally {
      setLoadingFileSystems(false);
    }
  }, []);

  // Delete a file system
  const handleDeleteFileSystem = async (fileSystemId: string, fileSystemType: string) => {
    if (!confirm(`Are you sure you want to delete this ${fileSystemType} file system? This action cannot be undone and all data will be lost.`)) {
      return;
    }
    
    setIsDeleting(true);
    setDeleteError(null);
    
    try {
      const session = await fetchAuthSession();
      const token = session.tokens?.idToken?.toString();
      
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_ENDPOINT}/admin/storage/filesystem`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fileSystemId, fileSystemType }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete file system');
      }
      
      alert(data.message || 'File system deletion initiated');
      setDeletingSystem(null);
      
      // Refresh the file systems list
      fetchFileSystems();
      fetchStorageConfig();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete file system');
    } finally {
      setIsDeleting(false);
    }
  };

  useEffect(() => {
    fetchStorageConfig();
    fetchObjects(currentPath);
    fetchFileSystems();
  }, [fetchStorageConfig, fetchObjects, fetchFileSystems, currentPath]);

  const navigateToFolder = (folderKey: string) => {
    setCurrentPath(folderKey);
    setSelectedFiles(new Set());
  };

  const navigateUp = () => {
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    setCurrentPath(parts.length > 0 ? parts.join('/') + '/' : '');
    setSelectedFiles(new Set());
  };

  const getBreadcrumbs = () => {
    const parts = currentPath.split('/').filter(Boolean);
    const breadcrumbs = [{ name: 'Root', path: '' }];
    let currentBreadcrumbPath = '';
    
    for (const part of parts) {
      currentBreadcrumbPath += part + '/';
      breadcrumbs.push({ name: part, path: currentBreadcrumbPath });
    }
    
    return breadcrumbs;
  };

  const toggleFileSelection = (key: string) => {
    const newSelected = new Set(selectedFiles);
    if (newSelected.has(key)) {
      newSelected.delete(key);
    } else {
      newSelected.add(key);
    }
    setSelectedFiles(newSelected);
  };

  const handleDownload = async (key: string) => {
    try {
      const session = await fetchAuthSession();
      const token = session.tokens?.idToken?.toString();
      
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_ENDPOINT}/admin/storage/download?key=${encodeURIComponent(key)}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        }
      );
      
      if (!response.ok) {
        throw new Error('Failed to get download URL');
      }
      
      const data = await response.json();
      window.open(data.url, '_blank');
    } catch (err) {
      alert(`Download failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const handleDelete = async (keys: string[]) => {
    if (!confirm(`Are you sure you want to delete ${keys.length} item(s)?`)) {
      return;
    }
    
    try {
      const session = await fetchAuthSession();
      const token = session.tokens?.idToken?.toString();
      
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_ENDPOINT}/admin/storage/delete`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ keys }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to delete files');
      }
      
      setSelectedFiles(new Set());
      fetchObjects(currentPath);
    } catch (err) {
      alert(`Delete failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    
    const newUploads: UploadProgress[] = Array.from(files).map(file => ({
      file: file.name,
      progress: 0,
      status: 'pending' as const,
    }));
    
    setUploads(prev => [...prev, ...newUploads]);
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const uploadIndex = uploads.length + i;
      
      try {
        // Update status to uploading
        setUploads(prev => prev.map((u, idx) => 
          idx === uploadIndex ? { ...u, status: 'uploading' as const } : u
        ));
        
        const session = await fetchAuthSession();
        const token = session.tokens?.idToken?.toString();
        
        // Get presigned URL
        const urlResponse = await fetch(
          `${process.env.NEXT_PUBLIC_API_ENDPOINT}/admin/storage/upload-url`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              key: currentPath + file.name,
              contentType: file.type || 'application/octet-stream',
            }),
          }
        );
        
        if (!urlResponse.ok) {
          throw new Error('Failed to get upload URL');
        }
        
        const { url } = await urlResponse.json();
        
        // Upload file with progress tracking
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          
          xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
              const progress = Math.round((e.loaded / e.total) * 100);
              setUploads(prev => prev.map((u, idx) => 
                idx === uploadIndex ? { ...u, progress } : u
              ));
            }
          });
          
          xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve();
            } else {
              reject(new Error(`Upload failed with status ${xhr.status}`));
            }
          });
          
          xhr.addEventListener('error', () => reject(new Error('Upload failed')));
          
          xhr.open('PUT', url);
          xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
          xhr.send(file);
        });
        
        // Update status to completed
        setUploads(prev => prev.map((u, idx) => 
          idx === uploadIndex ? { ...u, status: 'completed' as const, progress: 100 } : u
        ));
        
      } catch (err) {
        setUploads(prev => prev.map((u, idx) => 
          idx === uploadIndex ? { 
            ...u, 
            status: 'error' as const, 
            error: err instanceof Error ? err.message : 'Upload failed' 
          } : u
        ));
      }
    }
    
    // Refresh file list
    fetchObjects(currentPath);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFileUpload(e.dataTransfer.files);
  };

  const clearCompletedUploads = () => {
    setUploads(prev => prev.filter(u => u.status !== 'completed' && u.status !== 'error'));
  };

  return (
    <div className="space-y-6">
      {/* Sub-tabs */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="px-4 py-3 border-b border-gray-200">
          <div className="flex space-x-1 bg-gray-100 p-1 rounded-lg">
            {[
              { id: 'browser', label: 'File Browser', icon: '📁' },
              { id: 'upload', label: 'Upload', icon: '⬆️' },
              { id: 'deploy', label: 'Deploy Storage', icon: '🚀' },
              { id: 'settings', label: 'Storage Info', icon: '⚙️' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveSubTab(tab.id as any)}
                className={`flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                  activeSubTab === tab.id
                    ? 'bg-white text-blue-700 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <span className="mr-2">{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Storage Stats */}
        {stats && (
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
            <div className="grid grid-cols-4 gap-4">
              <div>
                <div className="text-xs text-gray-500">Transfer Bucket</div>
                <div className="text-sm font-medium text-gray-900 truncate">{stats.bucketName || 'Not configured'}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Total Objects</div>
                <div className="text-sm font-medium text-gray-900">{stats.totalObjects.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Total Size</div>
                <div className="text-sm font-medium text-gray-900">{formatFileSize(stats.totalSize)}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">EFS Status</div>
                <div className="text-sm font-medium text-green-600">{stats.efsStatus || 'Available'}</div>
              </div>
            </div>
          </div>
        )}

        {/* File Browser Tab */}
        {activeSubTab === 'browser' && (
          <div className="p-4">
            {/* Breadcrumbs */}
            <div className="flex items-center space-x-2 mb-4 text-sm">
              {getBreadcrumbs().map((crumb, index) => (
                <div key={crumb.path} className="flex items-center">
                  {index > 0 && <span className="text-gray-400 mx-1">/</span>}
                  <button
                    onClick={() => navigateToFolder(crumb.path)}
                    className={`hover:text-blue-600 ${
                      index === getBreadcrumbs().length - 1 ? 'font-medium text-gray-900' : 'text-gray-600'
                    }`}
                  >
                    {crumb.name}
                  </button>
                </div>
              ))}
            </div>

            {/* Toolbar */}
            <div className="flex justify-between items-center mb-4">
              <div className="flex space-x-2">
                {currentPath && (
                  <button
                    onClick={navigateUp}
                    className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50"
                  >
                    ⬆️ Up
                  </button>
                )}
                <button
                  onClick={() => fetchObjects(currentPath)}
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50"
                >
                  🔄 Refresh
                </button>
              </div>
              <div className="flex space-x-2">
                {selectedFiles.size > 0 && (
                  <>
                    <button
                      onClick={() => handleDelete(Array.from(selectedFiles))}
                      className="px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700"
                    >
                      🗑️ Delete ({selectedFiles.size})
                    </button>
                  </>
                )}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  ⬆️ Upload
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => handleFileUpload(e.target.files)}
                />
              </div>
            </div>

            {/* File List */}
            {isLoading ? (
              <div className="text-center py-8 text-gray-500">
                <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-2"></div>
                Loading...
              </div>
            ) : error ? (
              <div className="text-center py-8 text-red-500">
                <div className="text-4xl mb-2">⚠️</div>
                {error}
              </div>
            ) : objects.length === 0 ? (
              <div 
                className={`text-center py-12 border-2 border-dashed rounded-lg transition-colors ${
                  isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300'
                }`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <div className="text-4xl mb-2">📂</div>
                <div className="text-gray-500 mb-2">This folder is empty</div>
                <div className="text-sm text-gray-400">Drag and drop files here or click Upload</div>
              </div>
            ) : (
              <div 
                className={`border rounded-lg overflow-hidden ${isDragging ? 'border-blue-500' : 'border-gray-200'}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-8">
                        <input
                          type="checkbox"
                          checked={selectedFiles.size === objects.filter(o => !o.isFolder).length && objects.length > 0}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedFiles(new Set(objects.filter(o => !o.isFolder).map(o => o.key)));
                            } else {
                              setSelectedFiles(new Set());
                            }
                          }}
                          className="rounded border-gray-300"
                        />
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Size</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Modified</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Storage Class</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {objects.map((obj) => {
                      const displayName = obj.key.replace(currentPath, '').replace(/\/$/, '');
                      return (
                        <tr key={obj.key} className="hover:bg-gray-50">
                          <td className="px-4 py-3">
                            {!obj.isFolder && (
                              <input
                                type="checkbox"
                                checked={selectedFiles.has(obj.key)}
                                onChange={() => toggleFileSelection(obj.key)}
                                className="rounded border-gray-300"
                              />
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <button
                              onClick={() => obj.isFolder ? navigateToFolder(obj.key) : handleDownload(obj.key)}
                              className="flex items-center text-sm text-gray-900 hover:text-blue-600"
                            >
                              <span className="mr-2">{getFileIcon(obj.key, obj.isFolder)}</span>
                              {displayName}
                            </button>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {obj.isFolder ? '-' : formatFileSize(obj.size)}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {obj.lastModified ? formatDate(obj.lastModified) : '-'}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {obj.storageClass || '-'}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {!obj.isFolder && (
                              <div className="flex justify-end space-x-2">
                                <button
                                  onClick={() => handleDownload(obj.key)}
                                  className="text-blue-600 hover:text-blue-800 text-xs"
                                >
                                  Download
                                </button>
                                <button
                                  onClick={() => handleDelete([obj.key])}
                                  className="text-red-600 hover:text-red-800 text-xs"
                                >
                                  Delete
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Upload Tab */}
        {activeSubTab === 'upload' && (
          <div className="p-4">
            {/* Drop Zone */}
            <div
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
              }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <div className="text-6xl mb-4">📤</div>
              <div className="text-lg font-medium text-gray-900 mb-2">
                Drag and drop files here
              </div>
              <div className="text-gray-500 mb-4">or</div>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Browse Files
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => handleFileUpload(e.target.files)}
              />
              <div className="mt-4 text-sm text-gray-500">
                Files will be uploaded to: <span className="font-mono">{currentPath || '/'}</span>
              </div>
            </div>

            {/* Upload Progress */}
            {uploads.length > 0 && (
              <div className="mt-6">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-sm font-semibold text-gray-900">Upload Queue</h3>
                  <button
                    onClick={clearCompletedUploads}
                    className="text-xs text-gray-500 hover:text-gray-700"
                  >
                    Clear Completed
                  </button>
                </div>
                <div className="space-y-2">
                  {uploads.map((upload, index) => (
                    <div key={index} className="border rounded-lg p-3">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-sm font-medium text-gray-900 truncate">
                          {upload.file}
                        </span>
                        <span className={`text-xs px-2 py-1 rounded ${
                          upload.status === 'completed' ? 'bg-green-100 text-green-700' :
                          upload.status === 'error' ? 'bg-red-100 text-red-700' :
                          upload.status === 'uploading' ? 'bg-blue-100 text-blue-700' :
                          'bg-gray-100 text-gray-700'
                        }`}>
                          {upload.status}
                        </span>
                      </div>
                      {upload.status === 'uploading' && (
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                            style={{ width: `${upload.progress}%` }}
                          ></div>
                        </div>
                      )}
                      {upload.error && (
                        <div className="text-xs text-red-600 mt-1">{upload.error}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Deploy Storage Tab */}
        {activeSubTab === 'deploy' && (
          <div className="p-4 space-y-6">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-sm font-semibold text-blue-900 mb-2 flex items-center">
                    <span className="mr-2">ℹ️</span>
                    Storage Deployment & Management
                  </h3>
                  <p className="text-sm text-blue-700">
                    Deploy and manage file systems. You can deploy new storage systems or delete existing ones.
                    Deleting a file system will permanently remove all data stored on it.
                  </p>
                </div>
                <button
                  onClick={fetchFileSystems}
                  disabled={loadingFileSystems}
                  className="px-3 py-1.5 text-sm border border-blue-300 rounded hover:bg-blue-100 text-blue-700"
                >
                  {loadingFileSystems ? '🔄 Loading...' : '🔄 Refresh'}
                </button>
              </div>
            </div>

            {/* Deployed File Systems Section */}
            {deployedFileSystems.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center">
                  <span className="mr-2">📦</span>
                  Deployed File Systems ({deployedFileSystems.length})
                </h3>
                <div className="space-y-3">
                  {deployedFileSystems.map((fs) => (
                    <div
                      key={fs.id}
                      className="border border-green-300 bg-green-50 rounded-lg p-4"
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <div className="flex items-center space-x-2">
                            <span className="text-lg">
                              {fs.type === 'efs' && '💾'}
                              {fs.type === 'fsx-windows' && '🪟'}
                              {fs.type === 'fsx-lustre' && '⚡'}
                              {fs.type === 'fsx-ontap' && '🔷'}
                              {fs.type === 'fsx-openzfs' && '📦'}
                            </span>
                            <span className="font-semibold text-gray-900">{fs.name || fs.id}</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full ${
                              fs.status === 'available' || fs.status === 'AVAILABLE'
                                ? 'bg-green-100 text-green-700'
                                : 'bg-yellow-100 text-yellow-700'
                            }`}>
                              {fs.status}
                            </span>
                          </div>
                          <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-gray-600">
                            <div>
                              <span className="font-medium">ID:</span> {fs.id}
                            </div>
                            <div>
                              <span className="font-medium">Type:</span> {fs.type.toUpperCase()}
                            </div>
                            {fs.storageCapacity && (
                              <div>
                                <span className="font-medium">Size:</span> {fs.storageCapacity} GB
                              </div>
                            )}
                            {fs.sizeInBytes && (
                              <div>
                                <span className="font-medium">Size:</span> {(fs.sizeInBytes / (1024 * 1024 * 1024)).toFixed(2)} GB
                              </div>
                            )}
                            {fs.creationTime && (
                              <div>
                                <span className="font-medium">Created:</span> {new Date(fs.creationTime).toLocaleDateString()}
                              </div>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => setDeletingSystem(fs.id)}
                          className="ml-4 px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
                        >
                          🗑️ Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Storage Systems Grid */}
            <h3 className="text-sm font-semibold text-gray-900 mb-3">
              Available Storage Types
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {storageSystems.map((system) => (
                <div
                  key={system.id}
                  className={`border rounded-lg p-4 ${
                    system.status === 'deployed'
                      ? 'border-green-300 bg-green-50'
                      : system.status === 'deploying'
                      ? 'border-yellow-300 bg-yellow-50'
                      : 'border-gray-200 bg-white'
                  }`}
                >
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <h4 className="text-sm font-semibold text-gray-900 flex items-center">
                        {system.type === 'efs' && '💾'}
                        {system.type === 's3' && '🪣'}
                        {system.type === 'fsx-windows' && '🪟'}
                        {system.type === 'fsx-lustre' && '⚡'}
                        {system.type === 'fsx-ontap' && '🔷'}
                        {system.type === 'fsx-openzfs' && '📦'}
                        <span className="ml-2">{system.name}</span>
                      </h4>
                      <p className="text-xs text-gray-500 mt-1">{system.description}</p>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      system.status === 'deployed'
                        ? 'bg-green-100 text-green-700'
                        : system.status === 'deploying'
                        ? 'bg-yellow-100 text-yellow-700'
                        : 'bg-gray-100 text-gray-600'
                    }`}>
                      {system.status === 'deployed' ? '✓ Deployed' :
                       system.status === 'deploying' ? '⏳ Deploying' :
                       'Not Deployed'}
                    </span>
                  </div>

                  {/* Features */}
                  <div className="flex flex-wrap gap-1 mb-3">
                    {system.features.map((feature, idx) => (
                      <span key={idx} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                        {feature}
                      </span>
                    ))}
                  </div>

                  {/* Cost Estimate */}
                  {system.estimatedCost && (
                    <div className="text-xs text-gray-500 mb-3">
                      <span className="font-medium">Est. Cost:</span> {system.estimatedCost}
                    </div>
                  )}

                  {/* Deploy/Delete Buttons */}
                  {system.status === 'not-deployed' && (
                    <button
                      onClick={() => {
                        setDeployingSystem(system.id);
                      }}
                      className="w-full px-3 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                    >
                      🚀 Deploy {system.name}
                    </button>
                  )}

                  {system.status === 'deployed' && (
                    <div className="flex space-x-2">
                      <button
                        disabled
                        className="flex-1 px-3 py-2 text-sm bg-green-100 text-green-700 rounded cursor-default"
                      >
                        ✓ Deployed
                      </button>
                      {/* Only show delete for FSx systems, not base EFS/S3 */}
                      {(system.type !== 'efs' && system.type !== 's3') && (
                        <button
                          onClick={() => setDeletingSystem(system.id)}
                          className="px-3 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
                        >
                          🗑️ Delete
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Deployment Instructions Modal */}
            {deployingSystem && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
                  <div className="p-4 border-b border-gray-200">
                    <div className="flex justify-between items-center">
                      <h3 className="text-lg font-semibold text-gray-900">
                        Deploy {storageSystems.find(s => s.id === deployingSystem)?.name}
                      </h3>
                      <button
                        onClick={() => setDeployingSystem(null)}
                        className="text-gray-400 hover:text-gray-600"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                  <div className="p-4 space-y-4">
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                      <p className="text-sm text-yellow-800">
                        <strong>⚠️ Note:</strong> Deploying storage systems requires AWS CDK and appropriate IAM permissions.
                        Make sure you have configured your AWS credentials before running these commands.
                      </p>
                    </div>

                    <div>
                      <h4 className="text-sm font-semibold text-gray-900 mb-2">Prerequisites</h4>
                      <ul className="text-sm text-gray-600 list-disc list-inside space-y-1">
                        <li>AWS CDK installed (<code className="bg-gray-100 px-1 rounded">npm install -g aws-cdk</code>)</li>
                        <li>AWS credentials configured</li>
                        <li>Appropriate IAM permissions for the storage service</li>
                      </ul>
                    </div>

                    <div>
                      <h4 className="text-sm font-semibold text-gray-900 mb-2">Deployment Command</h4>
                      <div className="bg-gray-800 text-green-400 p-3 rounded-lg font-mono text-sm overflow-x-auto">
                        {deployingSystem === 'fsx-windows' && (
                          <>
                            <div className="text-gray-400"># Deploy FSx for Windows File Server</div>
                            <div>ENABLE_FSX_WINDOWS=true npx cdk deploy WorkstationStorage</div>
                            <div className="mt-2 text-gray-400"># Or with custom settings:</div>
                            <div>ENABLE_FSX_WINDOWS=true \</div>
                            <div>  FSX_WINDOWS_STORAGE_CAPACITY=300 \</div>
                            <div>  FSX_WINDOWS_THROUGHPUT=32 \</div>
                            <div>  npx cdk deploy WorkstationStorage</div>
                          </>
                        )}
                        {deployingSystem === 'fsx-lustre' && (
                          <>
                            <div className="text-gray-400"># Deploy FSx for Lustre</div>
                            <div>ENABLE_FSX_LUSTRE=true npx cdk deploy WorkstationStorage</div>
                            <div className="mt-2 text-gray-400"># Or with S3 integration:</div>
                            <div>ENABLE_FSX_LUSTRE=true \</div>
                            <div>  FSX_LUSTRE_DEPLOYMENT_TYPE=PERSISTENT_1 \</div>
                            <div>  FSX_LUSTRE_S3_IMPORT=s3://your-bucket/data \</div>
                            <div>  npx cdk deploy WorkstationStorage</div>
                          </>
                        )}
                        {deployingSystem === 'fsx-ontap' && (
                          <>
                            <div className="text-gray-400"># Deploy FSx for NetApp ONTAP</div>
                            <div>ENABLE_FSX_ONTAP=true npx cdk deploy WorkstationStorage</div>
                            <div className="mt-2 text-gray-400"># Or with custom configuration:</div>
                            <div>ENABLE_FSX_ONTAP=true \</div>
                            <div>  FSX_ONTAP_THROUGHPUT=128 \</div>
                            <div>  FSX_ONTAP_SSD_IOPS=3000 \</div>
                            <div>  npx cdk deploy WorkstationStorage</div>
                          </>
                        )}
                        {deployingSystem === 'fsx-openzfs' && (
                          <>
                            <div className="text-gray-400"># Deploy FSx for OpenZFS</div>
                            <div>ENABLE_FSX_OPENZFS=true npx cdk deploy WorkstationStorage</div>
                            <div className="mt-2 text-gray-400"># Or with custom configuration:</div>
                            <div>ENABLE_FSX_OPENZFS=true \</div>
                            <div>  FSX_OPENZFS_THROUGHPUT=64 \</div>
                            <div>  FSX_OPENZFS_COMPRESSION=ZSTD \</div>
                            <div>  npx cdk deploy WorkstationStorage</div>
                          </>
                        )}
                        {(deployingSystem === 'efs' || deployingSystem === 's3-transfer') && (
                          <>
                            <div className="text-gray-400"># This storage is already part of the base deployment</div>
                            <div>npx cdk deploy WorkstationStorage</div>
                          </>
                        )}
                      </div>
                    </div>

                    <div>
                      <h4 className="text-sm font-semibold text-gray-900 mb-2">After Deployment</h4>
                      <ul className="text-sm text-gray-600 list-disc list-inside space-y-1">
                        <li>The storage system will be available within 15-30 minutes</li>
                        <li>Mount points and access credentials will be stored in SSM Parameter Store</li>
                        <li>Security groups will be automatically configured</li>
                        <li>Refresh this page to see the updated status</li>
                      </ul>
                    </div>

                    <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
                      <button
                        onClick={() => setDeployingSystem(null)}
                        className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded hover:bg-gray-50"
                      >
                        Close
                      </button>
                      <button
                        onClick={() => {
                          // Copy command to clipboard
                          const command = deployingSystem === 'fsx-windows'
                            ? 'ENABLE_FSX_WINDOWS=true npx cdk deploy WorkstationStorage'
                            : deployingSystem === 'fsx-lustre'
                            ? 'ENABLE_FSX_LUSTRE=true npx cdk deploy WorkstationStorage'
                            : deployingSystem === 'fsx-ontap'
                            ? 'ENABLE_FSX_ONTAP=true npx cdk deploy WorkstationStorage'
                            : deployingSystem === 'fsx-openzfs'
                            ? 'ENABLE_FSX_OPENZFS=true npx cdk deploy WorkstationStorage'
                            : 'npx cdk deploy WorkstationStorage';
                          navigator.clipboard.writeText(command);
                          alert('Command copied to clipboard!');
                        }}
                        className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                      >
                        📋 Copy Command
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Delete Storage Modal */}
            {deletingSystem && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
                  <div className="p-4 border-b border-gray-200 bg-red-50">
                    <div className="flex justify-between items-center">
                      <h3 className="text-lg font-semibold text-red-900 flex items-center">
                        <span className="mr-2">⚠️</span>
                        Delete File System
                      </h3>
                      <button
                        onClick={() => {
                          setDeletingSystem(null);
                          setDeleteError(null);
                        }}
                        className="text-gray-400 hover:text-gray-600"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                  <div className="p-4 space-y-4">
                    {/* Find the file system details */}
                    {(() => {
                      const fs = deployedFileSystems.find(f => f.id === deletingSystem);
                      if (!fs) return null;
                      
                      return (
                        <>
                          <div className="bg-gray-100 rounded-lg p-3">
                            <div className="grid grid-cols-2 gap-2 text-sm">
                              <div><span className="font-medium">ID:</span> {fs.id}</div>
                              <div><span className="font-medium">Type:</span> {fs.type.toUpperCase()}</div>
                              <div><span className="font-medium">Name:</span> {fs.name || 'N/A'}</div>
                              <div><span className="font-medium">Status:</span> {fs.status}</div>
                            </div>
                          </div>

                          <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                            <p className="text-sm text-red-800">
                              <strong>⚠️ Warning:</strong> This will permanently delete the file system and all data stored on it.
                              This action cannot be undone. Make sure you have backed up any important data.
                            </p>
                          </div>

                          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                            <p className="text-sm text-yellow-800">
                              <strong>📋 Before deleting:</strong>
                            </p>
                            <ul className="list-disc list-inside mt-2 space-y-1 text-sm text-yellow-800">
                              <li>Ensure no workstations are actively using this file system</li>
                              <li>Back up any important data to S3 or another location</li>
                              <li>Verify no scheduled jobs depend on this storage</li>
                            </ul>
                          </div>

                          {deleteError && (
                            <div className="bg-red-50 border border-red-300 rounded-lg p-3">
                              <p className="text-sm text-red-800">
                                <strong>❌ Error:</strong> {deleteError}
                              </p>
                            </div>
                          )}

                          <div>
                            <h4 className="text-sm font-semibold text-gray-900 mb-2">What will happen:</h4>
                            <ul className="text-sm text-gray-600 list-disc list-inside space-y-1">
                              {fs.type === 'efs' && (
                                <>
                                  <li>All mount targets will be deleted first</li>
                                  <li>All access points will be removed</li>
                                  <li>The EFS file system will be permanently deleted</li>
                                  <li>SSM parameters will be cleaned up</li>
                                </>
                              )}
                              {fs.type.startsWith('fsx') && (
                                <>
                                  <li>Any child volumes will be deleted</li>
                                  <li>The FSx file system will be permanently deleted</li>
                                  <li>This process may take 10-30 minutes to complete</li>
                                </>
                              )}
                              {fs.type === 's3' && (
                                <>
                                  <li>All objects in the bucket will be deleted (including versions)</li>
                                  <li>The S3 bucket will be permanently deleted</li>
                                  <li>SSM parameters will be cleaned up</li>
                                </>
                              )}
                            </ul>
                          </div>

                          <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
                            <button
                              onClick={() => {
                                setDeletingSystem(null);
                                setDeleteError(null);
                              }}
                              disabled={isDeleting}
                              className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => handleDeleteFileSystem(fs.id, fs.type)}
                              disabled={isDeleting}
                              className="px-4 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 flex items-center"
                            >
                              {isDeleting ? (
                                <>
                                  <span className="animate-spin mr-2">⏳</span>
                                  Deleting...
                                </>
                              ) : (
                                <>
                                  🗑️ Delete File System
                                </>
                              )}
                            </button>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>
            )}

            {/* Terraform Module Info */}
            <div className="border rounded-lg p-4 bg-gray-50">
              <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center">
                <span className="mr-2">📦</span>
                Terraform Module Available
              </h3>
              <p className="text-sm text-gray-600 mb-3">
                For advanced deployments, use our comprehensive Terraform module that supports all AWS FSx
                file systems, EFS, and third-party storage solutions including NetApp Cloud Volumes ONTAP,
                Pure Storage, Portworx, and MinIO.
              </p>
              <div className="bg-gray-800 text-green-400 p-3 rounded-lg font-mono text-sm overflow-x-auto">
                <div className="text-gray-400"># In your Terraform configuration:</div>
                <div>module "enterprise_storage" {'{'}</div>
                <div>  source = "./terraform/modules/enterprise-storage"</div>
                <div></div>
                <div>  environment = "production"</div>
                <div>  vpc_id      = aws_vpc.main.id</div>
                <div>  subnet_ids  = aws_subnet.private[*].id</div>
                <div></div>
                <div>  enable_fsx_windows = true</div>
                <div>  enable_fsx_lustre  = true</div>
                <div>  enable_efs         = true</div>
                <div>{'}'}</div>
              </div>
              <div className="mt-3">
                <a
                  href="./terraform/modules/enterprise-storage/README.md"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-600 hover:text-blue-800"
                >
                  View Full Documentation →
                </a>
              </div>
            </div>
          </div>
        )}

        {/* Settings Tab */}
        {activeSubTab === 'settings' && (
          <div className="p-4 space-y-6">
            {/* S3 Transfer Bucket Info */}
            <div className="border rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center">
                <span className="text-xl mr-2">🪣</span>
                S3 Transfer Bucket
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-gray-500">Bucket Name</div>
                  <div className="text-sm font-mono text-gray-900">
                    {storageConfig.transferBucket || 'Not configured'}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Region</div>
                  <div className="text-sm text-gray-900">{storageConfig.region}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Encryption</div>
                  <div className="text-sm text-green-600">✓ KMS Encrypted</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Versioning</div>
                  <div className="text-sm text-green-600">✓ Enabled</div>
                </div>
              </div>
            </div>

            {/* EFS Info */}
            <div className="border rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center">
                <span className="text-xl mr-2">💾</span>
                Elastic File System (EFS)
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-gray-500">File System ID</div>
                  <div className="text-sm font-mono text-gray-900">
                    {storageConfig.efsFileSystemId || 'Not configured'}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Access Point ID</div>
                  <div className="text-sm font-mono text-gray-900">
                    {storageConfig.efsAccessPointId || 'Not configured'}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Performance Mode</div>
                  <div className="text-sm text-gray-900">General Purpose</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Throughput Mode</div>
                  <div className="text-sm text-gray-900">Bursting</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Lifecycle Policy</div>
                  <div className="text-sm text-gray-900">30 days → IA</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Encryption</div>
                  <div className="text-sm text-green-600">✓ At Rest (KMS)</div>
                </div>
              </div>
            </div>

            {/* Mount Instructions */}
            <div className="border rounded-lg p-4 bg-gray-50">
              <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center">
                <span className="text-xl mr-2">📋</span>
                Mount Instructions
              </h3>
              <div className="space-y-4">
                <div>
                  <div className="text-xs text-gray-500 mb-1">EFS Mount Command (Linux)</div>
                  <code className="block text-xs bg-gray-800 text-green-400 p-3 rounded overflow-x-auto">
                    sudo mount -t efs -o tls,accesspoint={storageConfig.efsAccessPointId || 'fsap-xxx'} {storageConfig.efsFileSystemId || 'fs-xxx'}:/ /mnt/efs
                  </code>
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-1">Windows Mount (via fstab)</div>
                  <code className="block text-xs bg-gray-800 text-green-400 p-3 rounded overflow-x-auto">
                    {storageConfig.efsFileSystemId || 'fs-xxx'}.efs.{storageConfig.region}.amazonaws.com:/ /mnt/efs efs defaults,_netdev,tls,accesspoint={storageConfig.efsAccessPointId || 'fsap-xxx'} 0 0
                  </code>
                </div>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="border rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">Quick Actions</h3>
              <div className="flex flex-wrap gap-2">
                <button className="px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50">
                  🔄 Refresh Status
                </button>
                <button className="px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50">
                  📊 View CloudWatch Metrics
                </button>
                <button className="px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50">
                  🔐 Manage Access
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}