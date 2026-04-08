//------------------------------------------------------------------------------
// S3 Browser Component - Navigate and Browse S3 Objects
//------------------------------------------------------------------------------

import React, { useEffect, useMemo, useState } from 'react';
import {
  Folder,
  File,
  ChevronRight,
  ChevronUp,
  RefreshCw,
  Download,
  Trash2,
  Search,
  Grid,
  List,
  CheckSquare,
  Square,
  MoreVertical,
  ArrowUpDown,
} from 'lucide-react';
import { useTransferStore } from '../stores/transferStore';
import { S3Object } from '../types';
import { formatBytes, formatDate } from '../utils/formatters';

interface S3BrowserProps {
  className?: string;
}

type ViewMode = 'list' | 'grid';
type SortField = 'name' | 'size' | 'lastModified';
type SortOrder = 'asc' | 'desc';

export const S3Browser: React.FC<S3BrowserProps> = ({ className = '' }) => {
  const {
    selectedBucket,
    s3CurrentPrefix,
    s3Objects,
    s3Loading,
    s3Error,
    s3SelectedKeys,
    navigateToPrefix,
    navigateUp,
    refreshS3,
    toggleS3Selection,
    selectS3Objects,
    clearS3Selection,
    downloadFiles,
  } = useTransferStore();

  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    object: S3Object;
  } | null>(null);

  // Filter and sort objects
  const filteredObjects = useMemo(() => {
    let filtered = s3Objects;

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((obj) =>
        obj.key.toLowerCase().includes(query)
      );
    }

    // Sort
    filtered = [...filtered].sort((a, b) => {
      // Folders always first
      if (a.isFolder && !b.isFolder) return -1;
      if (!a.isFolder && b.isFolder) return 1;

      let comparison = 0;
      switch (sortField) {
        case 'name':
          comparison = a.key.localeCompare(b.key);
          break;
        case 'size':
          comparison = a.size - b.size;
          break;
        case 'lastModified':
          comparison = new Date(a.lastModified).getTime() - new Date(b.lastModified).getTime();
          break;
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return filtered;
  }, [s3Objects, searchQuery, sortField, sortOrder]);

  // Get display name from key
  const getDisplayName = (key: string): string => {
    const withoutPrefix = key.replace(s3CurrentPrefix, '');
    return withoutPrefix.replace(/\/$/, '') || key;
  };

  // Get breadcrumbs
  const breadcrumbs = useMemo(() => {
    const parts = s3CurrentPrefix.split('/').filter(Boolean);
    return parts.map((part, index) => ({
      name: part,
      prefix: parts.slice(0, index + 1).join('/') + '/',
    }));
  }, [s3CurrentPrefix]);

  // Handle object click
  const handleObjectClick = (obj: S3Object) => {
    if (obj.isFolder) {
      navigateToPrefix(obj.key);
    } else {
      toggleS3Selection(obj.key);
    }
  };

  // Handle object double click
  const handleObjectDoubleClick = (obj: S3Object) => {
    if (obj.isFolder) {
      navigateToPrefix(obj.key);
    } else {
      // Download single file
      downloadFiles([obj]);
    }
  };

  // Handle select all
  const handleSelectAll = () => {
    const fileKeys = filteredObjects.filter((o) => !o.isFolder).map((o) => o.key);
    if (s3SelectedKeys.length === fileKeys.length) {
      clearS3Selection();
    } else {
      selectS3Objects(fileKeys);
    }
  };

  // Handle download selected
  const handleDownloadSelected = () => {
    const selectedObjects = s3Objects.filter((o) =>
      s3SelectedKeys.includes(o.key)
    );
    downloadFiles(selectedObjects);
  };

  // Handle sort change
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  // Context menu
  const handleContextMenu = (e: React.MouseEvent, obj: S3Object) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, object: obj });
  };

  // Close context menu on click outside
  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  if (!selectedBucket) {
    return (
      <div className={`flex items-center justify-center h-full text-gray-500 ${className}`}>
        <div className="text-center">
          <Folder className="w-12 h-12 mx-auto mb-2 opacity-50" />
          <p>Select a bucket to browse</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 p-2 border-b bg-gray-50">
        {/* Breadcrumbs */}
        <div className="flex items-center gap-1 flex-1 overflow-x-auto">
          <button
            onClick={() => navigateToPrefix('')}
            className="px-2 py-1 text-sm font-medium text-primary-600 hover:bg-primary-50 rounded"
          >
            {selectedBucket}
          </button>
          {breadcrumbs.map((crumb, index) => (
            <React.Fragment key={crumb.prefix}>
              <ChevronRight className="w-4 h-4 text-gray-400" />
              <button
                onClick={() => navigateToPrefix(crumb.prefix)}
                className="px-2 py-1 text-sm text-gray-700 hover:bg-gray-100 rounded"
              >
                {crumb.name}
              </button>
            </React.Fragment>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          {s3CurrentPrefix && (
            <button
              onClick={navigateUp}
              className="p-2 text-gray-600 hover:bg-gray-100 rounded"
              title="Go up"
            >
              <ChevronUp className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={refreshS3}
            className="p-2 text-gray-600 hover:bg-gray-100 rounded"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${s3Loading ? 'animate-spin' : ''}`} />
          </button>
          <div className="w-px h-6 bg-gray-300 mx-1" />
          <button
            onClick={() => setViewMode('list')}
            className={`p-2 rounded ${viewMode === 'list' ? 'bg-primary-100 text-primary-600' : 'text-gray-600 hover:bg-gray-100'}`}
            title="List view"
          >
            <List className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode('grid')}
            className={`p-2 rounded ${viewMode === 'grid' ? 'bg-primary-100 text-primary-600' : 'text-gray-600 hover:bg-gray-100'}`}
            title="Grid view"
          >
            <Grid className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Search and selection toolbar */}
      <div className="flex items-center gap-2 p-2 border-b">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search objects..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>

        {s3SelectedKeys.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">
              {s3SelectedKeys.length} selected
            </span>
            <button
              onClick={handleDownloadSelected}
              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-primary-600 text-white rounded hover:bg-primary-700"
            >
              <Download className="w-4 h-4" />
              Download
            </button>
            <button
              onClick={clearS3Selection}
              className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {/* Error message */}
      {s3Error && (
        <div className="p-4 bg-red-50 text-red-600 text-sm">
          {s3Error}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {s3Loading && s3Objects.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <RefreshCw className="w-6 h-6 animate-spin text-primary-600" />
          </div>
        ) : filteredObjects.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <Folder className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>{searchQuery ? 'No matching objects' : 'This folder is empty'}</p>
            </div>
          </div>
        ) : viewMode === 'list' ? (
          <table className="w-full">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="w-10 p-2">
                  <button
                    onClick={handleSelectAll}
                    className="p-1 hover:bg-gray-200 rounded"
                  >
                    {s3SelectedKeys.length > 0 &&
                    s3SelectedKeys.length === filteredObjects.filter((o) => !o.isFolder).length ? (
                      <CheckSquare className="w-4 h-4 text-primary-600" />
                    ) : (
                      <Square className="w-4 h-4 text-gray-400" />
                    )}
                  </button>
                </th>
                <th
                  className="text-left p-2 text-sm font-medium text-gray-600 cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('name')}
                >
                  <div className="flex items-center gap-1">
                    Name
                    {sortField === 'name' && (
                      <ArrowUpDown className="w-3 h-3" />
                    )}
                  </div>
                </th>
                <th
                  className="text-right p-2 text-sm font-medium text-gray-600 cursor-pointer hover:bg-gray-100 w-24"
                  onClick={() => handleSort('size')}
                >
                  <div className="flex items-center justify-end gap-1">
                    Size
                    {sortField === 'size' && (
                      <ArrowUpDown className="w-3 h-3" />
                    )}
                  </div>
                </th>
                <th
                  className="text-right p-2 text-sm font-medium text-gray-600 cursor-pointer hover:bg-gray-100 w-40"
                  onClick={() => handleSort('lastModified')}
                >
                  <div className="flex items-center justify-end gap-1">
                    Modified
                    {sortField === 'lastModified' && (
                      <ArrowUpDown className="w-3 h-3" />
                    )}
                  </div>
                </th>
                <th className="w-10 p-2" />
              </tr>
            </thead>
            <tbody>
              {filteredObjects.map((obj) => (
                <tr
                  key={obj.key}
                  className={`border-b hover:bg-gray-50 cursor-pointer ${
                    s3SelectedKeys.includes(obj.key) ? 'bg-primary-50' : ''
                  }`}
                  onClick={() => handleObjectClick(obj)}
                  onDoubleClick={() => handleObjectDoubleClick(obj)}
                  onContextMenu={(e) => handleContextMenu(e, obj)}
                >
                  <td className="p-2">
                    {!obj.isFolder && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleS3Selection(obj.key);
                        }}
                        className="p-1 hover:bg-gray-200 rounded"
                      >
                        {s3SelectedKeys.includes(obj.key) ? (
                          <CheckSquare className="w-4 h-4 text-primary-600" />
                        ) : (
                          <Square className="w-4 h-4 text-gray-400" />
                        )}
                      </button>
                    )}
                  </td>
                  <td className="p-2">
                    <div className="flex items-center gap-2">
                      {obj.isFolder ? (
                        <Folder className="w-5 h-5 text-yellow-500" />
                      ) : (
                        <File className="w-5 h-5 text-gray-400" />
                      )}
                      <span className="text-sm truncate">{getDisplayName(obj.key)}</span>
                    </div>
                  </td>
                  <td className="p-2 text-right text-sm text-gray-600">
                    {obj.isFolder ? '-' : formatBytes(obj.size)}
                  </td>
                  <td className="p-2 text-right text-sm text-gray-600">
                    {formatDate(obj.lastModified)}
                  </td>
                  <td className="p-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleContextMenu(e, obj);
                      }}
                      className="p-1 hover:bg-gray-200 rounded opacity-0 group-hover:opacity-100"
                    >
                      <MoreVertical className="w-4 h-4 text-gray-400" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          // Grid view
          <div className="p-4 grid grid-cols-4 gap-4">
            {filteredObjects.map((obj) => (
              <div
                key={obj.key}
                className={`p-4 border rounded-lg hover:shadow-md cursor-pointer ${
                  s3SelectedKeys.includes(obj.key) ? 'border-primary-500 bg-primary-50' : ''
                }`}
                onClick={() => handleObjectClick(obj)}
                onDoubleClick={() => handleObjectDoubleClick(obj)}
                onContextMenu={(e) => handleContextMenu(e, obj)}
              >
                <div className="flex flex-col items-center text-center">
                  {obj.isFolder ? (
                    <Folder className="w-12 h-12 text-yellow-500 mb-2" />
                  ) : (
                    <File className="w-12 h-12 text-gray-400 mb-2" />
                  )}
                  <span className="text-sm truncate w-full">{getDisplayName(obj.key)}</span>
                  {!obj.isFolder && (
                    <span className="text-xs text-gray-500">{formatBytes(obj.size)}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-white border rounded-lg shadow-lg py-1 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.object.isFolder ? (
            <>
              <button
                onClick={() => navigateToPrefix(contextMenu.object.key)}
                className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 flex items-center gap-2"
              >
                <Folder className="w-4 h-4" />
                Open
              </button>
              <button
                onClick={() => {
                  // Download folder
                  setContextMenu(null);
                }}
                className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                Download Folder
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => {
                  downloadFiles([contextMenu.object]);
                  setContextMenu(null);
                }}
                className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                Download
              </button>
              <button
                onClick={() => {
                  // Delete file
                  setContextMenu(null);
                }}
                className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 flex items-center gap-2 text-red-600"
              >
                <Trash2 className="w-4 h-4" />
                Delete
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default S3Browser;