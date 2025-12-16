# Copyright (c) 2025, WSO2 LLC. (https://www.wso2.com/) All Rights Reserved.

# WSO2 LLC. licenses this file to you under the Apache License,
# Version 2.0 (the "License"); you may not use this file except
# in compliance with the License.
# You may obtain a copy of the License at

# http://www.apache.org/licenses/LICENSE-2.0

# Unless required by applicable law or agreed to in writing,
# software distributed under the License is distributed on an
# "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
# KIND, either express or implied. See the License for the
# specific language governing permissions and limitations
# under the License.

import aiohttp
import logging
import json

from fhir_mcp_server.oauth import ServerConfigs

from typing import Any, Dict, List, Optional
from fhirpy import AsyncFHIRClient
from mcp.shared._httpx_utils import create_mcp_http_client

logger: logging.Logger = logging.getLogger(__name__)


async def on_request_start(session, trace_config_ctx, params):
    """Log FHIR API request details."""
    logger.info("[FHIR API REQUEST]")
    logger.info(f"  URL: {params.url}")
    logger.info(f"  Method: {params.method}")

    try:
        # Convert headers to dict and ensure all values are strings
        headers = {k: str(v) for k, v in dict(params.headers).items()}
        logger.info(f"  Headers: {json.dumps(headers, indent=2)}")
    except Exception as e:
        logger.info(f"  Headers: <error serializing headers: {e}>")

    if params.data:
        try:
            if isinstance(params.data, (dict, list)):
                # Ensure all values in dict/list are JSON serializable
                serializable_data = json.loads(json.dumps(params.data, default=str))
                logger.info(f"  Body: {json.dumps(serializable_data, indent=2)}")
            else:
                logger.info(f"  Body: {str(params.data)}")
        except Exception as e:
            logger.info(f"  Body: <error serializing body: {e}>")


async def on_request_end(session, trace_config_ctx, params):
    """Log FHIR API response details."""
    logger.info("[FHIR API RESPONSE]")
    logger.info(f"  URL: {params.url}")
    logger.info(f"  Status: {params.response.status}")
    logger.info(f"  Method: {params.method}")


async def on_request_exception(session, trace_config_ctx, params):
    """Log FHIR API request exceptions."""
    logger.error("[FHIR API ERROR]")
    logger.error(f"  URL: {params.url}")
    logger.error(f"  Method: {params.method}")
    logger.error(f"  Exception: {params.exception}")


async def create_async_fhir_client(
    config: ServerConfigs,
    access_token: str | None = None,
    extra_headers: dict | None = None,
) -> AsyncFHIRClient:
    """Create a FHIR AsyncClient with defaults."""

    trace_config = aiohttp.TraceConfig()
    trace_config.on_request_start.append(on_request_start)
    trace_config.on_request_end.append(on_request_end)
    trace_config.on_request_exception.append(on_request_exception)

    client_kwargs: Dict = {
        "url": config.server_base_url,
        "aiohttp_config": {
            "timeout": aiohttp.ClientTimeout(total=config.mcp_request_timeout),
            "trace_configs": [trace_config],
        },
        "extra_headers": extra_headers,
    }
    if access_token:
        client_kwargs["authorization"] = f"Bearer {access_token}"

    return AsyncFHIRClient(**client_kwargs)


async def get_bundle_entries(bundle: Dict[str, Any]) -> Dict[str, Any]:
    if bundle and "entry" in bundle and isinstance(bundle["entry"], list):
        logger.debug(f"found {len(bundle['entry'])} entries for type '{type}'")
        return {
            "entry": [
                entry.get("resource")
                for entry in bundle["entry"]
                if "resource" in entry
            ]
        }
    return bundle


def trim_resource_capabilities(
    capabilities: List[Dict[str, Any]],
) -> List[Dict[str, Optional[str]]]:
    logger.debug(
        f"trim_resource_capabilities called with {len(capabilities)} capabilities."
    )
    trimmed = [
        {
            "name": capability.get("name"),
            "documentation": capability.get("documentation"),
        }
        for capability in capabilities
        if "name" in capability or "documentation" in capability
    ]
    logger.debug(
        f"trim_resource_capabilities returning {len(trimmed)} trimmed capabilities."
    )
    return trimmed


async def get_operation_outcome_exception() -> dict:
    return await get_operation_outcome(
        code="exception", diagnostics="An unexpected internal error has occurred."
    )


async def get_operation_outcome_required_error(element: str = "") -> dict:
    return await get_operation_outcome(
        code="required", diagnostics=f"A required element {element} is missing."
    )


async def get_operation_outcome(
    code: str, diagnostics: str, severity: str = "error"
) -> dict:
    return {
        "resourceType": "OperationOutcome",
        "issue": [
            {
                "severity": severity,
                "code": code,
                "diagnostics": diagnostics,
            }
        ],
    }


async def get_capability_statement(metadata_url: str) -> Dict[str, Any]:
    """
    Discover CapabilityStatement from server's metadata endpoint.
    """
    try:
        headers = get_default_headers()

        logger.info("[FHIR REQUEST] Fetching CapabilityStatement")
        logger.info(f"  URL: {metadata_url}")
        logger.info(f"  Method: GET")
        logger.info(f"  Headers: {json.dumps(headers, indent=2)}")
        logger.debug(f"Fetching CapabilityStatement from {metadata_url}")

        async with create_mcp_http_client() as client:
            response = await client.get(url=metadata_url, headers=headers)

            logger.info("[FHIR RESPONSE] CapabilityStatement")
            logger.info(f"  Status: {response.status_code}")

            response.raise_for_status()
            metadata_json = response.json()
            logger.debug(f"OAuth metadata discovered: {metadata_json}")
            return metadata_json
    except Exception as ex:
        logger.exception(
            "Unable to invoke the FHIR metadata endpoint. Caused by, ", exc_info=ex
        )
        raise ValueError("Unable to fetch FHIR metadata")


def get_default_headers() -> Dict[str, str]:
    return {"Accept": "application/fhir+json", "Content-Type": "application/fhir+json"}


def build_user_profile(resource: Dict[str, Any]) -> Dict[str, Any]:
    """
    Build user profile dictionary from FHIR resource.

    Args:
        resource: The FHIR resource dictionary of the user.

    Returns:
        Dict containing only mandatory user fields
    """

    # Define fields to extract from the resource
    fields_to_extract = [
        "id",
        "resourceType",
        "name",
        "gender",
        "birthDate",
        "telecom",
        "address",
    ]

    profile: Dict[str, Any] = {}
    # Add fields only if they exist and have values
    for field in fields_to_extract:
        value = resource.get(field)
        if value is not None:
            profile[field] = value

    return profile
