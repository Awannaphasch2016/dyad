#!/usr/bin/env python3
"""Formatter tests for the inventory lines. No AWS calls."""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from list_gascity_running import (  # noqa: E402
    denial_label,
    describe_regions,
    ec2_lines,
    ecs_lines,
    regions,
)


class ListTest(unittest.TestCase):
    def test_regions_and_running_lines(self):
        self.assertEqual(
            regions({"Regions": [{"RegionName": "us-east-1"}, {"RegionName": "ap-southeast-1"}]}),
            ["ap-southeast-1", "us-east-1"],
        )
        lines = ec2_lines(
            "ap-southeast-1",
            {
                "Reservations": [
                    {
                        "Instances": [
                            {
                                "InstanceId": "i-running",
                                "State": {"Name": "running"},
                                "PublicIpAddress": "13.251.216.187",
                                "PrivateIpAddress": "172.31.14.171",
                                "Tags": [{"Key": "Name", "Value": "gascity"}],
                            },
                            {
                                "InstanceId": "i-stopped",
                                "State": {"Name": "stopped"},
                                "Tags": [{"Key": "Name", "Value": "old"}],
                            },
                        ]
                    }
                ]
            },
        )
        self.assertEqual(
            lines,
            [
                "region=ap-southeast-1 ec2 i-running name=gascity state=running public=13.251.216.187 private=172.31.14.171"
            ],
        )
        services = ecs_lines(
            "ap-southeast-1",
            [
                {
                    "clusterArn": "arn:aws:ecs:ap-southeast-1:755283537543:cluster/wewebplus-formula-preview",
                    "services": [
                        {
                            "serviceName": "formula-preview",
                            "desiredCount": 1,
                            "runningCount": 1,
                            "status": "ACTIVE",
                        }
                    ],
                }
            ],
        )
        self.assertEqual(
            services,
            [
                "region=ap-southeast-1 ecs cluster=wewebplus-formula-preview service=formula-preview desired=1 running=1 status=ACTIVE"
            ],
        )

    def test_describe_regions_retries_a_fresh_denial(self):
        self.assertEqual(
            denial_label(
                "An error occurred (UnauthorizedOperation) when calling the DescribeRegions operation: You are not authorized to perform this operation."
            ),
            "kind=not-allowed code=UnauthorizedOperation",
        )
        self.assertEqual(
            denial_label("explicit deny in a service control policy"),
            "kind=explicit-deny code=unknown",
        )
        calls = {"n": 0}
        waits = []

        def invoke():
            calls["n"] += 1
            if calls["n"] < 3:
                return {"denied": "An error occurred (UnauthorizedOperation) denied"}
            return {"Regions": [{"RegionName": "ap-southeast-1"}]}

        payload = describe_regions(invoke, waits.append)
        self.assertEqual(regions(payload), ["ap-southeast-1"])
        self.assertEqual(waits, [15, 15])
        self.assertEqual(calls["n"], 3)


if __name__ == "__main__":
    unittest.main()
