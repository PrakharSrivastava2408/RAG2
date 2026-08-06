import csv
import os

def split_csv_to_txt(csv_filename, output_dir):
    """
    Reads a CSV file and creates a new .txt file for every row.
    Combines the question/error and the answer/solution into one text chunk.
    """
    # Create the output directory if it doesn't exist
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
        print(f"Created directory: {output_dir}")

    try:
        # Open the CSV file. 
        # Using encoding='utf-8-sig' handles potential BOM characters in some CSVs.
        with open(csv_filename, mode='r', encoding='utf-8-sig') as csvfile:
            # DictReader uses the first row as the dictionary keys (headers)
            reader = csv.DictReader(csvfile)
            
            # Check if the CSV is empty
            if not reader.fieldnames:
                print("Error: The CSV file appears to be empty or has no headers.")
                return

            row_count = 0
            for index, row in enumerate(reader):
                # Ensure we have data in this row
                if not any(row.values()):
                    continue
                
                # Construct the content for the text file.
                # We iterate through the dictionary so this works regardless of 
                # what the specific column headers are in your CSV.
                file_content = []
                for header, value in row.items():
                    # Clean up the text
                    clean_header = str(header).strip()
                    clean_value = str(value).strip() if value else "N/A"
                    file_content.append(f"{clean_header}:\n{clean_value}\n")
                
                # Join the elements with a blank line between them
                final_text = "\n".join(file_content)
                
                # Create a safe filename using the row index
                txt_filename = os.path.join(output_dir, f"nginx_qna_{index + 1}.txt")
                
                # Write to the new text file
                with open(txt_filename, 'w', encoding='utf-8') as txtfile:
                    txtfile.write(final_text)
                
                row_count += 1
                
        print(f"\n✅ Success! Converted {row_count} rows into text files.")
        print(f"Check the '{output_dir}' directory.")

    except FileNotFoundError:
        print(f"❌ Error: Could not find the file '{csv_filename}'.")
        print("Please make sure it is in the same directory as this script.")
    except Exception as e:
         print(f"❌ An unexpected error occurred: {e}")

# === Configuration ===
# The name of your input file
input_csv_file = 'nginx_tagged_rows.csv' 

# The folder where the .txt files will be saved
# Saving them directly to the 'data' folder makes them ready for ingest.js
output_directory = 'data' 

# Execute the function
split_csv_to_txt(input_csv_file, output_directory)