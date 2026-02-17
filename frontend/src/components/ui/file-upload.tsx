'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Upload, File, X, CheckCircle2, AlertCircle, FileSpreadsheet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';

interface FileUploadProps {
  accept?: string;
  maxSize?: number; // in MB
  multiple?: boolean;
  onFilesSelected?: (files: File[]) => void;
  onUpload?: (files: File[]) => Promise<void>;
  className?: string;
  description?: string;
}

interface UploadedFile {
  file: File;
  progress: number;
  status: 'pending' | 'uploading' | 'success' | 'error';
  error?: string;
}

export function FileUpload({
  accept = '.csv,.xlsx,.xls',
  maxSize = 10,
  multiple = false,
  onFilesSelected,
  onUpload,
  className,
  description = 'Drag and drop your files here, or click to browse',
}: FileUploadProps) {
  const [isDragging, setIsDragging] = React.useState(false);
  const [files, setFiles] = React.useState<UploadedFile[]>([]);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const validateFile = (file: File): string | null => {
    if (maxSize && file.size > maxSize * 1024 * 1024) {
      return `File size exceeds ${maxSize}MB limit`;
    }
    const acceptedTypes = accept.split(',').map(t => t.trim());
    const fileExt = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!acceptedTypes.some(type => fileExt === type || file.type.includes(type.replace('.', '')))) {
      return 'File type not supported';
    }
    return null;
  };

  const addFiles = (newFiles: FileList | null) => {
    if (!newFiles) return;

    const filesToAdd: UploadedFile[] = Array.from(newFiles).map(file => {
      const error = validateFile(file);
      return {
        file,
        progress: 0,
        status: error ? 'error' : 'pending',
        error,
      } as UploadedFile;
    });

    if (!multiple) {
      setFiles(filesToAdd.slice(0, 1));
    } else {
      setFiles(prev => [...prev, ...filesToAdd]);
    }

    const validFiles = filesToAdd
      .filter(f => f.status !== 'error')
      .map(f => f.file);
    if (validFiles.length > 0 && onFilesSelected) {
      onFilesSelected(validFiles);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    addFiles(e.dataTransfer.files);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    addFiles(e.target.files);
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleUpload = async () => {
    if (!onUpload) return;

    const validFiles = files.filter(f => f.status === 'pending');
    if (validFiles.length === 0) return;

    // Update status to uploading
    setFiles(prev =>
      prev.map(f =>
        f.status === 'pending' ? { ...f, status: 'uploading' as const } : f
      )
    );

    // Simulate upload progress
    const progressInterval = setInterval(() => {
      setFiles(prev =>
        prev.map(f =>
          f.status === 'uploading' && f.progress < 90
            ? { ...f, progress: f.progress + 10 }
            : f
        )
      );
    }, 200);

    try {
      await onUpload(validFiles.map(f => f.file));
      clearInterval(progressInterval);
      setFiles(prev =>
        prev.map(f =>
          f.status === 'uploading'
            ? { ...f, status: 'success' as const, progress: 100 }
            : f
        )
      );
    } catch {
      clearInterval(progressInterval);
      setFiles(prev =>
        prev.map(f =>
          f.status === 'uploading'
            ? { ...f, status: 'error' as const, error: 'Upload failed' }
            : f
        )
      );
    }
  };

  const getFileIcon = (file: UploadedFile) => {
    if (file.status === 'success') return CheckCircle2;
    if (file.status === 'error') return AlertCircle;
    return FileSpreadsheet;
  };

  const getFileIconColor = (file: UploadedFile) => {
    if (file.status === 'success') return 'text-emerald-500';
    if (file.status === 'error') return 'text-red-500';
    return 'text-primary';
  };

  return (
    <div className={cn('space-y-4', className)}>
      {/* Drop zone */}
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          'relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed py-32 px-8 transition-all cursor-pointer',
          isDragging
            ? 'border-primary bg-primary/5 scale-[1.02]'
            : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50'
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          onChange={handleFileSelect}
          className="hidden"
        />
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 mb-4">
          <Upload className="h-7 w-7 text-primary" />
        </div>
        <p className="text-sm font-medium text-foreground mb-1">{description}</p>
        <p className="text-xs text-muted-foreground">
          Supports: {accept.replace(/\./g, '').toUpperCase()} (Max {maxSize}MB)
        </p>
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((file, index) => {
            const Icon = getFileIcon(file);
            return (
              <div
                key={index}
                className={cn(
                  'flex items-center gap-3 rounded-lg border p-3 transition-all',
                  file.status === 'error' && 'border-red-200 bg-red-50',
                  file.status === 'success' && 'border-emerald-200 bg-emerald-50'
                )}
              >
                <Icon className={cn('h-5 w-5 shrink-0', getFileIconColor(file))} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{file.file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(file.file.size / 1024).toFixed(1)} KB
                    {file.error && (
                      <span className="text-red-500 ml-2">{file.error}</span>
                    )}
                  </p>
                  {file.status === 'uploading' && (
                    <Progress value={file.progress} className="h-1 mt-2" />
                  )}
                </div>
                {(file.status === 'pending' || file.status === 'error') && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFile(index);
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            );
          })}

          {/* Upload button */}
          {onUpload && files.some(f => f.status === 'pending') && (
            <Button onClick={handleUpload} className="w-full mt-2">
              <Upload className="h-4 w-4 mr-2" />
              Upload {files.filter(f => f.status === 'pending').length} file(s)
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// Simple upload button variant
interface UploadButtonProps {
  accept?: string;
  onFileSelect?: (file: File) => void;
  children?: React.ReactNode;
  className?: string;
}

export function UploadButton({
  accept = '.csv,.xlsx,.xls',
  onFileSelect,
  children,
  className,
}: UploadButtonProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onFileSelect) {
      onFileSelect(file);
    }
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleChange}
        className="hidden"
      />
      <Button
        variant="outline"
        onClick={() => inputRef.current?.click()}
        className={className}
      >
        {children || (
          <>
            <Upload className="h-4 w-4 mr-2" />
            Upload File
          </>
        )}
      </Button>
    </>
  );
}
