# Amazon DCV Integration Architecture

**Date:** 2025-11-17  
**Status:** Planning Phase  
**User Request:** Integrate Amazon DCV as alternative to RDP with UDP QUIC enabled by default

## Overview

Amazon DCV (Desktop Cloud Visualization) is a high-performance remote display protocol that enables users to securely access graphic-intensive applications running on remote servers. This document outlines the architecture for integrating DCV into the workstation management system.

## Requirements

1. ✅ Security group template already exists with DCV ports (TCP 8443, UDP 8443)
2. Add DCV server installation to EC2 UserData bootstrap script
3. Enable UDP QUIC protocol by default for optimal performance
4. Create DCV bootstrap package in DynamoDB
5. Enhance security group IP whitelisting to support DCV ports
6. Add DCV connection modal in frontend (similar to RDP modal)
7. Add DCV connection button alongside RDP button
8. Support both RDP and DCV on same workstation

## Key URLs & Resources

- **DCV Downloads:** https://www.amazondcv.com/
- **DCV Server Installer (Windows):** https://d1uj6qtbmh3dt5.cloudfront.net/nice-dcv-server-x64-Release.msi
- **Client Installation Guide:** https://docs.aws.amazon.com/dcv/latest/userguide/client-windows.html#client-windows-install
- **Port Configuration Guide:** https://docs.aws.amazon.com/dcv/latest/adminguide/manage-port-addr.html
- **QUIC Configuration:** https://docs.aws.amazon.com/dcv/latest/adminguide/enable-quic.html

## DCV Technical Specifications

### Network Requirements
- **TCP Port 8443:** HTTPS connection (console access, session management)
- **UDP Port 8443:** QUIC protocol (streaming, low-latency performance)
- **Protocols:** HTTPS/TLS 1.2+ for TCP, QUIC for UDP

### Server Requirements (Windows)
- Windows Server 2016/2019/2022/2025
- .NET Framework 4.8 or later
- NICE DCV Server (latest version)
- Valid DCV license (demo license available for testing)

### Authentication Methods
- **Console Session:** Single session, no authentication required (Windows login)
- **Virtual Session:** Multiple sessions, DCV authentication required
- **External Authentication:** LDAP, Active Directory integration

### QUIC Protocol Benefits
- 30-50% lower latency compared to TCP
- Better performance on unreliable networks
- Improved responsiveness for interactive applications
- Automatic fallback to TCP if UDP blocked

## Architecture Components

### 1. Backend (Lambda) Changes

#### File: `src/lambda/ec2-management/index.ts`

##### A. DCV Bootstrap Package (DynamoDB)
```typescript
{
  packageId: "dcv-server-2024",
  name: "Amazon DCV Server 2024",
  description: "NICE DCV Server for high-performance remote desktop with UDP QUIC",
  type: "application",
  category: "remote-access",
  downloadUrl: "https://d1uj6qtbmh3dt5.cloudfront.net/nice-dcv-server-x64-Release.msi",
  installCommand: "Start-Process msiexec.exe -ArgumentList",
  installArgs: "/i INSTALLER_PATH /quiet /norestart ADDLOCAL=ALL",
  requiresGpu: false,
  osVersions: ["windows-server-2025", "windows-server-2022", "windows-server-2019", "windows-server-2016"],
  isRequired: false,
  isEnabled: true,
  order: 15,
  estimatedInstallTimeMinutes: 5,
  metadata: {
    version: "2024.1",
    vendor: "AWS/NICE",
    ports: [8443],
    protocols: ["TCP", "UDP"],
    quicEnabled: true
  }
}
```

##### B. Enhanced `addIpToSecurityGroup()` Function
**Current Implementation:** Only adds RDP port 3389  
**Required Change:** Support multiple ports dynamically

```typescript
async function addIpToSecurityGroup(
  groupId: string, 
  ipAddress: string, 
  description: string,
  ports: Array<{port: number, protocol: 'tcp' | 'udp'}>
): Promise<void>
```

**Ports to Add:**
- RDP: TCP 3389
- DCV: TCP 8443, UDP 8443

##### C. Enhanced UserData Script Generation

**Add to `generateUserDataScript()` function:**

```powershell
# Configure DCV Server with UDP QUIC
if (Test-Path "C:\Program Files\NICE\DCV\Server\bin\dcv.exe") {
    Write-Output "Configuring DCV Server..."
    
    # Enable QUIC (UDP transport)
    & "C:\Program Files\NICE\DCV\Server\bin\dcvconf.exe" enable-quic
    
    # Set QUIC port to 8443 (same as HTTPS for firewall simplicity)
    & "C:\Program Files\NICE\DCV\Server\bin\dcvconf.exe" set connectivity.enable-quic-frontend true
    & "C:\Program Files\NICE\DCV\Server\bin\dcvconf.exe" set connectivity.quic-port 8443
    
    # Configure authentication (use Windows authentication)
    & "C:\Program Files\NICE\DCV\Server\bin\dcvconf.exe" set security.authentication "system"
    
    # Enable console session (automatic login with Windows credentials)
    & "C:\Program Files\NICE\DCV\Server\bin\dcvconf.exe" set session-management.create-session true
    & "C:\Program Files\NICE\DCV\Server\bin\dcvconf.exe" set session-management.automatic-console-session true
    
    # Configure firewall rules
    New-NetFirewallRule -DisplayName "DCV Server TCP" -Direction Inbound -LocalPort 8443 -Protocol TCP -Action Allow
    New-NetFirewallRule -DisplayName "DCV Server UDP QUIC" -Direction Inbound -LocalPort 8443 -Protocol UDP -Action Allow
    
    # Restart DCV server to apply configuration
    Restart-Service dcvserver
    
    Write-Output "✓ DCV Server configured with UDP QUIC enabled"
} else {
    Write-Output "⚠ DCV Server not installed"
}
```

##### D. Enhanced Credentials Response

**Add to connection info in `getWorkstation()` function:**

```typescript
const connectionInfo = instance?.State?.Name === 'running' ? {
  publicIp: workstation.publicIp,
  rdp: {
    port: 3389,
    protocol: 'RDP'
  },
  dcv: {
    port: 8443,
    protocol: 'DCV',
    quicEnabled: true,
    webUrl: `https://${workstation.publicIp}:8443`
  },
  credentials: {
    type: workstation.authMethod,
    username: workstation.localAdminUser || 'Administrator',
    domain: workstation.domainName
  }
} : undefined;
```

### 2. Frontend Changes

#### A. DCV Connection Modal Component

**File:** `frontend/src/components/workstation/DcvConnectionModal.tsx` (NEW)

**Features:**
- Display DCV connection URL (https://HOST:8443)
- Show QUIC status indicator
- Copy connection URL button
- Download .dcv session file
- Instructions for DCV client download
- WebSocket URL for web browser access
- Fallback to web browser option

**Similar to:** `RdpCredentialsModal.tsx` (270 lines)

**Key Differences:**
- DCV uses web URL format instead of hostname:port
- Include QUIC protocol indicator
- Link to DCV client download
- Web browser access option
- Session file download (.dcv format)

#### B. Main Dashboard Integration

**File:** `frontend/pages/index.tsx`

**Changes Required:**

1. Import DCV modal component
2. Add DCV state management
3. Add DCV button next to RDP button
4. Handle DCV connection click
5. Render DCV modal

```typescript
// State
const [showDcvModal, setShowDcvModal] = useState(false)
const [dcvConnection, setDcvConnection] = useState<any>(null)

// Button (add after RDP button)
<button
  onClick={() => handleDcvConnect(ws)}
  className="btn-secondary"
  title="Connect via Amazon DCV"
>
  🖥️ DCV
</button>

// Handler
const handleDcvConnect = async (ws: any) => {
  const creds = await apiClient.getWorkstationCredentials(ws.workstationId);
  setDcvConnection({
    url: `https://${ws.publicIp}:8443`,
    quicEnabled: true,
    username: creds.username,
    password: creds.password
  });
  setSelectedWorkstation(ws);
  setShowDcvModal(true);
};
```

#### C. API Types Update

**File:** `frontend/src/types/index.ts`

**Add DCV types:**

```typescript
export interface DcvConnection {
  url: string;
  port: number;
  quicEnabled: boolean;
  protocol: 'DCV';
  sessionFile?: string;
}

export interface WorkstationCredentials {
  username: string;
  password: string;
  rdpFile?: string;
  dcvConnection?: DcvConnection;
}
```

### 3. Security Group Enhancement

**Current State:**  
- LaunchWorkstationModal.tsx already has "Amazon DCV" template
- Template includes TCP 8443 and UDP 8443

**Enhancement Needed:**  
When users click "Allow My IP" on dashboard, add both RDP and DCV ports:

```typescript
// In security-group-service Lambda or frontend
const allowMyIpPorts = [
  { port: 3389, protocol: 'tcp', description: 'RDP' },
  { port: 8443, protocol: 'tcp', description: 'DCV HTTPS' },
  { port: 8443, protocol: 'udp', description: 'DCV QUIC' }
];
```

## Implementation Plan

### Phase 1: Backend Foundation
1. ✅ Analyze existing code structure
2. ✅ Identify DCV security group template exists
3. Create DCV bootstrap package in DynamoDB
4. Enhance `addIpToSecurityGroup()` for multiple ports
5. Update UserData script with DCV installation and QUIC configuration
6. Add DCV connection info to credentials API response
7. Test DCV server installation on test instance

### Phase 2: Frontend Development
1. Create `DcvConnectionModal.tsx` component
2. Update dashboard (`index.tsx`) with DCV button
3. Add DCV state management
4. Integrate credentials API changes
5. Test modal UI and copy functionality

### Phase 3: Integration & Testing
1. Deploy backend Lambda changes
2. Deploy frontend build
3. Launch test workstation with DCV template
4. Verify DCV server installed correctly
5. Test DCV connection from client
6. Verify UDP QUIC protocol active
7. Test fallback to TCP if UDP blocked

### Phase 4: Documentation & Rollout
1. Create user guide for DCV connections
2. Update system documentation
3. Store implementation details in memory
4. Monitor CloudWatch logs for issues
5. Gather user feedback

## DCV vs RDP Comparison

| Feature | RDP | DCV |
|---------|-----|-----|
| **Protocol** | RDP (TCP) | HTTPS/QUIC (TCP/UDP) |
| **Port** | 3389 | 8443 |
| **Latency** | Standard | 30-50% lower with QUIC |
| **GPU Support** | Limited | Excellent (hardware accelerated) |
| **H.264 Encoding** | Basic | Advanced |
| **4K Support** | Limited | Native |
| **Linux Support** | No | Yes |
| **Web Browser** | No | Yes (HTML5) |
| **License Cost** | Included in Windows | Free for personal use, paid for commercial |

## Security Considerations

1. **TLS Encryption:** DCV uses TLS 1.2+ for all connections
2. **Certificate Management:** Self-signed cert by default, can use custom cert
3. **Authentication:** Integrated with Windows authentication
4. **Firewall Rules:** Automatically configured in UserData script
5. **IP Whitelisting:** Applied at security group level (same as RDP)

## Troubleshooting Guide

### DCV Server Not Accessible
1. Check security group has TCP 8443 and UDP 8443 open
2. Verify Windows Firewall rules were created
3. Check DCV service is running: `Get-Service dcvserver`
4. Review installation log: `C:\WorkstationSetup.log`

### QUIC Not Working
1. Verify UDP 8443 is open in security group
2. Check QUIC enabled: `dcvconf get connectivity.enable-quic-frontend`
3. Test UDP connectivity: `Test-NetConnection -ComputerName HOST -Port 8443 -Protocol UDP`
4. Review DCV server logs: `C:\ProgramData\NICE\DCV\log`

### Authentication Failed
1. Verify Windows credentials are correct
2. Check authentication mode: `dcvconf get security.authentication`
3. Ensure console session is enabled
4. Review DCV authentication logs

## Cost Impact

- **DCV License:** Free for personal use on EC2 (no additional cost)
- **Network:** UDP may use slightly more bandwidth for better quality
- **Storage:** DCV server ~150MB
- **Installation Time:** ~5 minutes added to bootstrap

## Testing Checklist

- [ ] DCV bootstrap package created in DynamoDB
- [ ] UserData script installs DCV server successfully
- [ ] QUIC protocol enabled by default
- [ ] TCP 8443 and UDP 8443 ports open
- [ ] DCV service starts automatically
- [ ] Windows authentication works
- [ ] DCV modal displays correctly
- [ ] Connection URL copyable
- [ ] Session file downloads
- [ ] Can connect via DCV native client
- [ ] Can connect via web browser
- [ ] QUIC protocol active (verify in DCV logs)
- [ ] Fallback to TCP works if UDP blocked
- [ ] Both RDP and DCV work on same instance

## Files to Modify

### Backend
1. `src/lambda/ec2-management/index.ts` - Main changes
   - Line 1990-2018: `addIpToSecurityGroup()` function
   - Line 1725-1899: `generateUserDataScript()` function
   - Line 899-924: Connection info in `getWorkstation()`

### Frontend
1. `frontend/src/components/workstation/DcvConnectionModal.tsx` - NEW FILE
2. `frontend/pages/index.tsx` - Add DCV button and modal
3. `frontend/src/types/index.ts` - Add DCV types

### Database
1. Bootstrap packages table - Add DCV package entry

## Success Criteria

1. ✅ Users can launch workstations with DCV ports open
2. ✅ DCV server automatically installs and configures
3. ✅ UDP QUIC protocol enabled by default
4. ✅ DCV connection modal shows connection details
5. ✅ Users can copy DCV connection URL
6. ✅ Users can download .dcv session file
7. ✅ DCV client can connect successfully
8. ✅ QUIC protocol provides lower latency
9. ✅ Both RDP and DCV work on same workstation
10. ✅ "Allow My IP" adds DCV ports to security group

## References

- [AWS DCV Admin Guide](https://docs.aws.amazon.com/dcv/latest/adminguide/)
- [AWS DCV User Guide](https://docs.aws.amazon.com/dcv/latest/userguide/)
- [DCV QUIC Configuration](https://docs.aws.amazon.com/dcv/latest/adminguide/enable-quic.html)
- [DCV Port Configuration](https://docs.aws.amazon.com/dcv/latest/adminguide/manage-port-addr.html)
- [DCV Windows Client Installation](https://docs.aws.amazon.com/dcv/latest/userguide/client-windows.html)

## Next Steps

1. Switch to Code mode to implement backend changes
2. Create DCV bootstrap package script
3. Modify ec2-management Lambda
4. Create DCV modal component
5. Update dashboard with DCV button
6. Deploy and test complete flow