import os
import pathlib
import sys
import zipfile


def main():
    source_path = pathlib.Path(sys.argv[1]).resolve()
    output_path = pathlib.Path(sys.argv[2]).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        if source_path.is_dir():
            for child in sorted(source_path.rglob("*")):
                if child.is_file():
                    archive.write(child, child.relative_to(source_path.parent))
        else:
            archive.write(source_path, source_path.name)

    with zipfile.ZipFile(output_path, "r") as archive:
        file_entries = [name for name in archive.namelist() if not name.endswith("/")]

    print(output_path)
    print(len(file_entries))


if __name__ == "__main__":
    main()
