#!/bin/bash
# Reload Nginx after a successful renewal so it serves the new certificate.
systemctl reload nginx
