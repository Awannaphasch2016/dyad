"""Roll the Gas City host forward.

Dagger only starts the host script through the host Docker socket. Secret
values stay in the host env file and never become Dagger arguments.
"""

from .main import Gascity as Gascity
