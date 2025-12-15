# Deploying FHIR MCP Server to Render

This guide will help you deploy your FHIR MCP Server to Render.com.

## Prerequisites

- A [Render account](https://render.com) (free tier available)
- Your GitHub repository connected to Render
- FHIR server details (base URL, credentials if required)

## Deployment Methods

### Method 1: Using render.yaml (Recommended)

This method uses Infrastructure as Code for easy deployment.

1. **Push the render.yaml file to your repository**
   ```bash
   git add render.yaml .renderignore
   git commit -m "Add Render deployment configuration"
   git push origin main
   ```

2. **Create a new Web Service on Render**
   - Go to [Render Dashboard](https://dashboard.render.com/)
   - Click "New +" → "Blueprint"
   - Connect your GitHub repository
   - Render will automatically detect the `render.yaml` file
   - Click "Apply" to create the service

3. **Configure Environment Variables**
   
   After the blueprint is applied, you need to set the required environment variables:
   
   - Go to your service in the Render Dashboard
   - Navigate to "Environment" tab
   - Set the following **required** variables:
     - `FHIR_SERVER_BASE_URL`: Your FHIR server URL (e.g., `https://hapi.fhir.org/baseR5`)
   
   - If your FHIR server requires authentication, also set:
     - `FHIR_SERVER_CLIENT_ID`: Your OAuth client ID
     - `FHIR_SERVER_CLIENT_SECRET`: Your OAuth client secret
     - `FHIR_SERVER_SCOPES`: OAuth scopes (default: `fhirUser openid`)
   
   - Optional variables (already set in render.yaml):
     - `FHIR_SERVER_DISABLE_AUTHORIZATION`: Set to `True` to disable auth
     - `FHIR_SERVER_INCLUDE_AUD`: Set to `True` for servers like ECW Cloud
     - `FHIR_SERVER_ENABLE_BASIC_AUTH`: Set to `True` for Basic auth token exchange

4. **Deploy**
   - Click "Manual Deploy" → "Deploy latest commit" or wait for auto-deploy
   - Monitor the deployment logs
   - Once deployed, your service will be available at: `https://your-service-name.onrender.com`

### Method 2: Manual Setup via Dashboard

1. **Create a new Web Service**
   - Go to [Render Dashboard](https://dashboard.render.com/)
   - Click "New +" → "Web Service"
   - Connect your GitHub repository
   - Select the repository containing your FHIR MCP Server

2. **Configure the service**
   - **Name**: `fhir-mcp-server` (or your preferred name)
   - **Region**: Choose your preferred region
   - **Branch**: `main` (or your default branch)
   - **Runtime**: Docker
   - **Dockerfile Path**: `./Dockerfile`
   - **Docker Context**: `.`
   - **Instance Type**: Free or Starter (depending on your needs)

3. **Set Environment Variables**
   
   Add the following environment variables in the "Environment" section:
   
   **Required:**
   - `FHIR_MCP_HOST`: `0.0.0.0`
   - `FHIR_MCP_PORT`: `8000`
   - `FHIR_SERVER_BASE_URL`: Your FHIR server URL
   
   **Optional (for authenticated FHIR servers):**
   - `FHIR_SERVER_CLIENT_ID`: Your client ID
   - `FHIR_SERVER_CLIENT_SECRET`: Your client secret (mark as secret)
   - `FHIR_SERVER_SCOPES`: `fhirUser openid`
   - `FHIR_SERVER_DISABLE_AUTHORIZATION`: `False`
   - `FHIR_MCP_REQUEST_TIMEOUT`: `30`

4. **Advanced Settings**
   - **Health Check Path**: `/`
   - **Auto-Deploy**: Enable (recommended)

5. **Create Web Service**
   - Click "Create Web Service"
   - Wait for the initial deployment to complete

## Post-Deployment

### Verify Deployment

Once deployed, you can verify your service is running:

```bash
curl https://your-service-name.onrender.com/
```

### View Logs

- Go to your service in the Render Dashboard
- Click on "Logs" tab to view real-time logs
- Monitor for any errors or issues

### Update Environment Variables

To update environment variables after deployment:
1. Go to your service → "Environment" tab
2. Update the variable values
3. The service will automatically redeploy

## Troubleshooting

### Common Issues

1. **Service fails to start**
   - Check logs for error messages
   - Verify all required environment variables are set
   - Ensure `FHIR_SERVER_BASE_URL` is accessible from Render

2. **Authentication errors**
   - Verify OAuth credentials are correct
   - Check if `FHIR_SERVER_SCOPES` match your FHIR server requirements
   - For ECW Cloud, ensure `FHIR_SERVER_INCLUDE_AUD=True`

3. **Connection timeout**
   - Increase `FHIR_MCP_REQUEST_TIMEOUT` value
   - Check if FHIR server is accessible from Render's network

4. **Port binding issues**
   - Ensure `FHIR_MCP_HOST=0.0.0.0` (not localhost)
   - Verify `FHIR_MCP_PORT=8000`

### Getting Help

- Check the [Render documentation](https://render.com/docs)
- Review service logs in the Render Dashboard
- Check the FHIR MCP Server [GitHub repository](https://github.com/sanketdhokteincubyte/fhir-mcp-server)

## Scaling

To scale your service:
1. Go to your service → "Settings" tab
2. Change the "Instance Type" to a higher tier
3. Save changes and redeploy

## Custom Domain

To add a custom domain:
1. Go to your service → "Settings" tab
2. Scroll to "Custom Domain" section
3. Add your domain and follow DNS configuration instructions

## Cost Considerations

- **Free Tier**: Limited to 750 hours/month, spins down after 15 minutes of inactivity
- **Starter Tier**: $7/month, always on, better performance
- **Standard Tier**: $25/month, more resources and features

Choose based on your usage requirements.

