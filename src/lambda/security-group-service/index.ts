import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import {
  EC2Client,
  DescribeSecurityGroupsCommand,
  AuthorizeSecurityGroupIngressCommand,
  RevokeSecurityGroupIngressCommand,
  CreateSecurityGroupCommand,
  DeleteSecurityGroupCommand,
  DescribeSecurityGroupRulesCommand,
  DescribeInstancesCommand,
  ModifyInstanceAttributeCommand,
  IpPermission
} from '@aws-sdk/client-ec2';
import { DynamoDBClient, GetItemCommand, PutItemCommand, UpdateItemCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { v4 as uuidv4 } from 'uuid';

const ec2Client = new EC2Client({});
const dynamoClient = new DynamoDBClient({});

const VPC_ID = process.env.VPC_ID!;
const USERS_TABLE = process.env.USERS_TABLE!;
const AUDIT_LOGS_TABLE = process.env.AUDIT_TABLE!;
const WORKSTATIONS_TABLE = process.env.WORKSTATIONS_TABLE_NAME!;

// Common application ports
const COMMON_PORTS: Record<string, { port: number; protocol: string; description: string }> = {
  'rdp': { port: 3389, protocol: 'tcp', description: 'Remote Desktop Protocol' },
  'ssh': { port: 22, protocol: 'tcp', description: 'Secure Shell' },
  'http': { port: 80, protocol: 'tcp', description: 'HTTP Web Server' },
  'https': { port: 443, protocol: 'tcp', description: 'HTTPS Web Server' },
  'ftp': { port: 21, protocol: 'tcp', description: 'File Transfer Protocol' },
  'sftp': { port: 22, protocol: 'tcp', description: 'SSH File Transfer Protocol' },
  'mysql': { port: 3306, protocol: 'tcp', description: 'MySQL Database' },
  'postgresql': { port: 5432, protocol: 'tcp', description: 'PostgreSQL Database' },
  'mongodb': { port: 27017, protocol: 'tcp', description: 'MongoDB Database' },
  'redis': { port: 6379, protocol: 'tcp', description: 'Redis Cache' },
  'smtp': { port: 25, protocol: 'tcp', description: 'Simple Mail Transfer Protocol' },
  'smtps': { port: 465, protocol: 'tcp', description: 'SMTP over SSL' },
  'imap': { port: 143, protocol: 'tcp', description: 'Internet Message Access Protocol' },
  'imaps': { port: 993, protocol: 'tcp', description: 'IMAP over SSL' },
  'vnc': { port: 5900, protocol: 'tcp', description: 'Virtual Network Computing' },
  'minecraft': { port: 25565, protocol: 'tcp', description: 'Minecraft Server' },
  'dns': { port: 53, protocol: 'udp', description: 'Domain Name System' },
  'ntp': { port: 123, protocol: 'udp', description: 'Network Time Protocol' },
};

type Permission = 
  | 'security:read'
  | 'security:manage'
  | 'system:admin';

interface EnhancedUser {
  userId: string;
  status: 'active' | 'inactive' | 'suspended';
  roleIds: string[];
  groupIds: string[];
  directPermissions: Permission[];
}

async function getUserPermissions(userId: string): Promise<Permission[]> {
  console.log(`[getUserPermissions] Fetching permissions for user: ${userId}`);
  
  try {
    const userResult = await dynamoClient.send(new GetItemCommand({
      TableName: USERS_TABLE,
      Key: marshall({ userId }),
    }));

    if (!userResult.Item) {
      console.log(`[getUserPermissions] User not found, returning default permissions`);
      return ['security:read'];
    }

    const user = unmarshall(userResult.Item) as EnhancedUser;
    const permissions = new Set<Permission>(user.directPermissions || []);
    
    // In production, would fetch from roles and groups as well
    // For now, simple permission check
    
    return Array.from(permissions);
  } catch (error) {
    console.error('[getUserPermissions] Error:', error);
    return ['security:read'];
  }
}

async function hasPermission(userId: string, permission: Permission): Promise<boolean> {
  const permissions = await getUserPermissions(userId);
  return permissions.includes(permission) || permissions.includes('system:admin');
}

async function logAuditEvent(userId: string, action: string, resourceType: string, resourceId: string, details?: any): Promise<void> {
  try {
    const auditLog = {
      auditId: uuidv4(),
      userId,
      action,
      resourceType,
      resourceId,
      details: details ? JSON.stringify(details) : undefined,
      timestamp: new Date().toISOString(),
    };

    await dynamoClient.send(new PutItemCommand({
      TableName: AUDIT_LOGS_TABLE,
      Item: marshall(auditLog),
    }));
  } catch (error) {
    console.error('[logAuditEvent] Error:', error);
  }
}

export const handler = async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
  console.log('='.repeat(80));
  console.log('=== Security Group Management Handler Started ===');
  console.log('Event:', JSON.stringify(event, null, 2));
  
  try {
    const { httpMethod, pathParameters, body, requestContext } = event;
    const userId = requestContext.authorizer?.claims?.email || 
                   requestContext.authorizer?.claims?.sub || 
                   'unknown';

    console.log('User ID:', userId);
    console.log('HTTP Method:', httpMethod);
    console.log('Path Parameters:', pathParameters);

    const corsHeaders = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
    };

    switch (httpMethod) {
      case 'GET':
        if (event.path.includes('/workstations')) {
          // List workstations for a security group
          if (!(await hasPermission(userId, 'security:read'))) {
            return {
              statusCode: 403,
              headers: corsHeaders,
              body: JSON.stringify({ message: 'Insufficient permissions' }),
            };
          }
          const groupId = event.queryStringParameters?.groupId;
          if (!groupId) {
            return {
              statusCode: 400,
              headers: corsHeaders,
              body: JSON.stringify({ message: 'groupId query parameter required' }),
            };
          }
          return await getWorkstationsForSecurityGroup(groupId, userId);
        } else if (pathParameters?.groupId) {
          // Get specific security group
          if (!(await hasPermission(userId, 'security:read'))) {
            return {
              statusCode: 403,
              headers: corsHeaders,
              body: JSON.stringify({ message: 'Insufficient permissions' }),
            };
          }
          return await getSecurityGroup(pathParameters.groupId, userId);
        } else if (event.path.includes('/common-ports')) {
          // Get list of common ports
          return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({ ports: COMMON_PORTS }),
          };
        } else {
          // List all security groups
          if (!(await hasPermission(userId, 'security:read'))) {
            return {
              statusCode: 403,
              headers: corsHeaders,
              body: JSON.stringify({ message: 'Insufficient permissions' }),
            };
          }
          return await listSecurityGroups(userId);
        }

      case 'POST':
        if (event.path.includes('/attach-to-workstation')) {
          // Attach security group to workstation
          if (!(await hasPermission(userId, 'security:manage'))) {
            return {
              statusCode: 403,
              headers: corsHeaders,
              body: JSON.stringify({ message: 'Insufficient permissions to manage security groups' }),
            };
          }
          const attachRequest = JSON.parse(body || '{}');
          return await attachSecurityGroupToWorkstation(attachRequest, userId);
        } else if (event.path.includes('/allow-my-ip')) {
          // Add user's IP to workstation security group
          const allowMyIpRequest = JSON.parse(body || '{}');
          return await allowMyIpToWorkstation(allowMyIpRequest, userId, event);
        } else if (event.path.includes('/add-rule')) {
          // Add ingress rule
          if (!(await hasPermission(userId, 'security:manage'))) {
            return {
              statusCode: 403,
              headers: corsHeaders,
              body: JSON.stringify({ message: 'Insufficient permissions to manage security groups' }),
            };
          }
          const addRequest = JSON.parse(body || '{}');
          return await addSecurityGroupRule(addRequest, userId);
        } else {
          // Create new security group
          if (!(await hasPermission(userId, 'security:manage'))) {
            return {
              statusCode: 403,
              headers: corsHeaders,
              body: JSON.stringify({ message: 'Insufficient permissions to create security groups' }),
            };
          }
          const createRequest = JSON.parse(body || '{}');
          return await createSecurityGroup(createRequest, userId);
        }

      case 'DELETE':
        if (event.path.includes('/remove-rule')) {
          // Remove ingress rule
          if (!(await hasPermission(userId, 'security:manage'))) {
            return {
              statusCode: 403,
              headers: corsHeaders,
              body: JSON.stringify({ message: 'Insufficient permissions to manage security groups' }),
            };
          }
          const removeRequest = JSON.parse(body || '{}');
          return await removeSecurityGroupRule(removeRequest, userId);
        } else if (pathParameters?.groupId) {
          // Delete security group
          if (!(await hasPermission(userId, 'security:manage'))) {
            return {
              statusCode: 403,
              headers: corsHeaders,
              body: JSON.stringify({ message: 'Insufficient permissions to delete security groups' }),
            };
          }
          return await deleteSecurityGroup(pathParameters.groupId, userId);
        }
        break;
    }

    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'Invalid request' }),
    };
  } catch (error) {
    console.error('Internal error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({
        error: 'An internal error occurred. Please try again later.',
      }),
    };
  }
};

async function listSecurityGroups(userId: string): Promise<APIGatewayProxyResult> {
  console.log('Listing security groups for VPC:', VPC_ID);
  
  try {
    const command = new DescribeSecurityGroupsCommand({
      Filters: [
        { Name: 'vpc-id', Values: [VPC_ID] }
      ],
    });

    const result = await ec2Client.send(command);
    
    const securityGroups = result.SecurityGroups?.map(sg => ({
      groupId: sg.GroupId,
      groupName: sg.GroupName,
      description: sg.Description,
      vpcId: sg.VpcId,
      ingressRules: sg.IpPermissions?.length || 0,
      egressRules: sg.IpPermissionsEgress?.length || 0,
      tags: sg.Tags?.reduce((acc, tag) => {
        if (tag.Key && tag.Value) {
          acc[tag.Key] = tag.Value;
        }
        return acc;
      }, {} as Record<string, string>),
    })) || [];

    await logAuditEvent(userId, 'LIST_SECURITY_GROUPS', 'security-groups', 'all');

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({ securityGroups }),
    };
  } catch (error) {
    console.error('Error listing security groups:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({
        message: 'Failed to list security groups',
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
    };
  }
}

async function getSecurityGroup(groupId: string, userId: string): Promise<APIGatewayProxyResult> {
  console.log('Getting security group:', groupId);
  
  try {
    const command = new DescribeSecurityGroupsCommand({
      GroupIds: [groupId],
    });

    const result = await ec2Client.send(command);
    const sg = result.SecurityGroups?.[0];

    if (!sg) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        },
        body: JSON.stringify({ message: 'Security group not found' }),
      };
    }

    const securityGroup = {
      groupId: sg.GroupId,
      groupName: sg.GroupName,
      description: sg.Description,
      vpcId: sg.VpcId,
      ingressRules: sg.IpPermissions?.map(rule => ({
        ipProtocol: rule.IpProtocol,
        fromPort: rule.FromPort,
        toPort: rule.ToPort,
        ipRanges: rule.IpRanges?.map(r => ({
          cidrIp: r.CidrIp,
          description: r.Description,
        })),
        ipv6Ranges: rule.Ipv6Ranges?.map(r => ({
          cidrIpv6: r.CidrIpv6,
          description: r.Description,
        })),
        userIdGroupPairs: rule.UserIdGroupPairs?.map(p => ({
          groupId: p.GroupId,
          description: p.Description,
        })),
      })) || [],
      egressRules: sg.IpPermissionsEgress?.map(rule => ({
        ipProtocol: rule.IpProtocol,
        fromPort: rule.FromPort,
        toPort: rule.ToPort,
        ipRanges: rule.IpRanges?.map(r => ({
          cidrIp: r.CidrIp,
          description: r.Description,
        })),
      })) || [],
      tags: sg.Tags?.reduce((acc, tag) => {
        if (tag.Key && tag.Value) {
          acc[tag.Key] = tag.Value;
        }
        return acc;
      }, {} as Record<string, string>),
    };

    await logAuditEvent(userId, 'GET_SECURITY_GROUP', 'security-group', groupId);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify(securityGroup),
    };
  } catch (error) {
    console.error('Error getting security group:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({
        message: 'Failed to get security group',
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
    };
  }
}

async function addSecurityGroupRule(request: {
  groupId: string;
  port?: number;
  fromPort?: number;
  toPort?: number;
  protocol: string;
  cidrIp: string;
  description?: string;
  applicationName?: string;
}, userId: string): Promise<APIGatewayProxyResult> {
  console.log('Adding security group rule:', request);
  
  try {
    const { groupId, port, fromPort, toPort, protocol, cidrIp, description, applicationName } = request;

    // Use applicationName to get port if provided
    let actualPort = port;
    let actualFromPort = fromPort;
    let actualToPort = toPort;
    let actualDescription = description;

    if (applicationName && COMMON_PORTS[applicationName]) {
      const commonPort = COMMON_PORTS[applicationName];
      actualPort = commonPort.port;
      actualFromPort = commonPort.port;
      actualToPort = commonPort.port;
      actualDescription = actualDescription || commonPort.description;
    }

    const ipPermission: IpPermission = {
      IpProtocol: protocol,
      FromPort: actualFromPort || actualPort,
      ToPort: actualToPort || actualPort,
      IpRanges: [{
        CidrIp: cidrIp,
        Description: actualDescription,
      }],
    };

    const command = new AuthorizeSecurityGroupIngressCommand({
      GroupId: groupId,
      IpPermissions: [ipPermission],
    });

    await ec2Client.send(command);

    await logAuditEvent(userId, 'ADD_SECURITY_GROUP_RULE', 'security-group', groupId, request);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({ 
        message: 'Rule added successfully',
        rule: ipPermission 
      }),
    };
  } catch (error) {
    console.error('Error adding security group rule:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({
        message: 'Failed to add security group rule',
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
    };
  }
}

async function removeSecurityGroupRule(request: {
  groupId: string;
  port?: number;
  fromPort?: number;
  toPort?: number;
  protocol: string;
  cidrIp: string;
}, userId: string): Promise<APIGatewayProxyResult> {
  console.log('Removing security group rule:', request);
  
  try {
    const { groupId, port, fromPort, toPort, protocol, cidrIp } = request;

    const ipPermission: IpPermission = {
      IpProtocol: protocol,
      FromPort: fromPort || port,
      ToPort: toPort || port,
      IpRanges: [{
        CidrIp: cidrIp,
      }],
    };

    const command = new RevokeSecurityGroupIngressCommand({
      GroupId: groupId,
      IpPermissions: [ipPermission],
    });

    await ec2Client.send(command);

    await logAuditEvent(userId, 'REMOVE_SECURITY_GROUP_RULE', 'security-group', groupId, request);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({ message: 'Rule removed successfully' }),
    };
  } catch (error) {
    console.error('Error removing security group rule:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({
        message: 'Failed to remove security group rule',
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
    };
  }
}

async function createSecurityGroup(request: {
  groupName: string;
  description: string;
}, userId: string): Promise<APIGatewayProxyResult> {
  console.log('Creating security group:', request);
  
  try {
    const command = new CreateSecurityGroupCommand({
      GroupName: request.groupName,
      Description: request.description,
      VpcId: VPC_ID,
    });

    const result = await ec2Client.send(command);

    await logAuditEvent(userId, 'CREATE_SECURITY_GROUP', 'security-group', result.GroupId || 'unknown', request);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({ 
        groupId: result.GroupId,
        message: 'Security group created successfully' 
      }),
    };
  } catch (error) {
    console.error('Error creating security group:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({
        message: 'Failed to create security group',
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
    };
  }
}

async function deleteSecurityGroup(groupId: string, userId: string): Promise<APIGatewayProxyResult> {
  console.log('Deleting security group:', groupId);
  
  try {
    const command = new DeleteSecurityGroupCommand({
      GroupId: groupId,
    });

    await ec2Client.send(command);

    await logAuditEvent(userId, 'DELETE_SECURITY_GROUP', 'security-group', groupId);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({ message: 'Security group deleted successfully' }),
    };
  } catch (error) {
    console.error('Error deleting security group:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({
        message: 'Failed to delete security group',
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
    };
  }
}

async function getWorkstationsForSecurityGroup(groupId: string, userId: string): Promise<APIGatewayProxyResult> {
  console.log('Getting workstations for security group:', groupId);
  
  try {
    // First, verify the security group exists
    const sgCommand = new DescribeSecurityGroupsCommand({
      GroupIds: [groupId],
    });
    await ec2Client.send(sgCommand);
    
    // Scan DynamoDB for workstations using this security group
    const scanCommand = new ScanCommand({
      TableName: WORKSTATIONS_TABLE,
      FilterExpression: 'securityGroupId = :groupId',
      ExpressionAttributeValues: marshall({
        ':groupId': groupId,
      }),
    });
    
    const result = await dynamoClient.send(scanCommand);
    const workstations = (result.Items || []).map(item => {
      const ws = unmarshall(item);
      return {
        workstationId: ws.PK?.replace('WORKSTATION#', '') || ws.workstationId,
        instanceId: ws.instanceId,
        userId: ws.userId,
        status: ws.status,
        instanceType: ws.instanceType,
        region: ws.region,
        publicIp: ws.publicIp,
      };
    });
    
    // Also get instances from EC2 to ensure we have current data
    const describeCommand = new DescribeInstancesCommand({
      Filters: [
        { Name: 'instance.group-id', Values: [groupId] },
        { Name: 'instance-state-name', Values: ['pending', 'running', 'stopping', 'stopped'] },
      ],
    });
    
    const ec2Result = await ec2Client.send(describeCommand);
    const ec2Instances = ec2Result.Reservations?.flatMap(r => r.Instances || []) || [];
    
    await logAuditEvent(userId, 'LIST_WORKSTATIONS_FOR_SG', 'security-group', groupId);
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({
        securityGroupId: groupId,
        workstations,
        ec2InstanceCount: ec2Instances.length,
      }),
    };
  } catch (error) {
    console.error('Error getting workstations for security group:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({
        message: 'Failed to get workstations for security group',
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
    };
  }
}

async function attachSecurityGroupToWorkstation(request: {
  workstationId: string;
  securityGroupId: string;
}, userId: string): Promise<APIGatewayProxyResult> {
  console.log('Attaching security group to workstation:', request);
  
  try {
    const { workstationId, securityGroupId } = request;
    
    // Get workstation record
    const getCommand = new GetItemCommand({
      TableName: WORKSTATIONS_TABLE,
      Key: marshall({
        PK: `WORKSTATION#${workstationId}`,
        SK: 'METADATA',
      }),
    });
    
    const wsResult = await dynamoClient.send(getCommand);
    if (!wsResult.Item) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        },
        body: JSON.stringify({ message: 'Workstation not found' }),
      };
    }
    
    const workstation = unmarshall(wsResult.Item);
    const instanceId = workstation.instanceId;
    
    // Verify security group exists and is in same VPC
    const sgCommand = new DescribeSecurityGroupsCommand({
      GroupIds: [securityGroupId],
    });
    const sgResult = await ec2Client.send(sgCommand);
    const securityGroup = sgResult.SecurityGroups?.[0];
    
    if (!securityGroup) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        },
        body: JSON.stringify({ message: 'Security group not found' }),
      };
    }
    
    if (securityGroup.VpcId !== workstation.vpcId) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        },
        body: JSON.stringify({
          message: 'Security group must be in the same VPC as the workstation',
          workstationVpc: workstation.vpcId,
          securityGroupVpc: securityGroup.VpcId,
        }),
      };
    }
    
    // Modify instance attribute to change security group
    const modifyCommand = new ModifyInstanceAttributeCommand({
      InstanceId: instanceId,
      Groups: [securityGroupId],
    });
    
    await ec2Client.send(modifyCommand);
    
    // Update DynamoDB record
    const updateCommand = new UpdateItemCommand({
      TableName: WORKSTATIONS_TABLE,
      Key: marshall({
        PK: `WORKSTATION#${workstationId}`,
        SK: 'METADATA',
      }),
      UpdateExpression: 'SET securityGroupId = :sgId, updatedAt = :timestamp',
      ExpressionAttributeValues: marshall({
        ':sgId': securityGroupId,
        ':timestamp': new Date().toISOString(),
      }),
    });
    
    await dynamoClient.send(updateCommand);
    
    await logAuditEvent(userId, 'ATTACH_SECURITY_GROUP', 'workstation', workstationId, {
      securityGroupId,
      previousSecurityGroupId: workstation.securityGroupId,
    });
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({
        message: 'Security group attached successfully',
        workstationId,
        securityGroupId,
        previousSecurityGroupId: workstation.securityGroupId,
      }),
    };
  } catch (error) {
    console.error('Error attaching security group to workstation:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({
        message: 'Failed to attach security group to workstation',
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
    };
  }
}

async function allowMyIpToWorkstation(request: {
  workstationId: string;
}, userId: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Adding user IP to workstation security group:', request);
  
  try {
    const { workstationId } = request;
    
    // Get user's IP address
    const userIp = getUserIpFromEvent(event);
    if (!userIp) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        },
        body: JSON.stringify({
          message: 'Could not determine your IP address',
          details: 'Please ensure you are accessing from a valid network'
        }),
      };
    }
    
    // Get workstation record
    const getCommand = new GetItemCommand({
      TableName: WORKSTATIONS_TABLE,
      Key: marshall({
        PK: `WORKSTATION#${workstationId}`,
        SK: 'METADATA',
      }),
    });
    
    const wsResult = await dynamoClient.send(getCommand);
    if (!wsResult.Item) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        },
        body: JSON.stringify({ message: 'Workstation not found' }),
      };
    }
    
    const workstation = unmarshall(wsResult.Item);
    
    // Check if user owns this workstation or is admin
    if (workstation.userId !== userId) {
      // Check if user has admin permissions
      const permissions = await getUserPermissions(userId);
      if (!permissions.includes('system:admin') && !permissions.includes('security:manage')) {
        return {
          statusCode: 403,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
            'Access-Control-Allow-Headers': 'Content-Type,Authorization',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
          },
          body: JSON.stringify({ message: 'Access denied - you can only modify your own workstations' }),
        };
      }
    }
    
    const securityGroupId = workstation.securityGroupId;
    if (!securityGroupId) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        },
        body: JSON.stringify({ message: 'Workstation has no security group assigned' }),
      };
    }
    
    // Add IP to security group
    const cidrIp = userIp.includes('/') ? userIp : `${userIp}/32`;
    
    try {
      const command = new AuthorizeSecurityGroupIngressCommand({
        GroupId: securityGroupId,
        IpPermissions: [{
          IpProtocol: 'tcp',
          FromPort: 3389,
          ToPort: 3389,
          IpRanges: [{
            CidrIp: cidrIp,
            Description: `RDP access for ${userId}`,
          }],
        }],
      });
      
      await ec2Client.send(command);
      
      await logAuditEvent(userId, 'ALLOW_MY_IP', 'workstation', workstationId, {
        ipAddress: cidrIp,
        securityGroupId,
      });
      
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        },
        body: JSON.stringify({
          message: 'Your IP address has been whitelisted for RDP access',
          ipAddress: cidrIp,
          securityGroupId,
          workstationId,
        }),
      };
    } catch (error: any) {
      // If rule already exists, that's okay
      if (error.name === 'InvalidPermission.Duplicate') {
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
            'Access-Control-Allow-Headers': 'Content-Type,Authorization',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
          },
          body: JSON.stringify({
            message: 'Your IP address is already whitelisted',
            ipAddress: cidrIp,
            securityGroupId,
            workstationId,
          }),
        };
      }
      throw error;
    }
  } catch (error) {
    console.error('Error adding user IP to workstation:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({
        message: 'Failed to whitelist your IP address',
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
    };
  }
}

function getUserIpFromEvent(event: APIGatewayProxyEvent): string | null {
  // Try to get IP from various headers (API Gateway, CloudFront, direct)
  const sourceIp = event.requestContext?.identity?.sourceIp;
  const xForwardedFor = event.headers?.['X-Forwarded-For'] || event.headers?.['x-forwarded-for'];
  const xRealIp = event.headers?.['X-Real-IP'] || event.headers?.['x-real-ip'];
  
  // X-Forwarded-For can contain multiple IPs, take the first one (original client)
  if (xForwardedFor) {
    const ips = xForwardedFor.split(',');
    return ips[0].trim();
  }
  
  if (xRealIp) {
    return xRealIp;
  }
  
  if (sourceIp) {
    return sourceIp;
  }
  
  return null;
}