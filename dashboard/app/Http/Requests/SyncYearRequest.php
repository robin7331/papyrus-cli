<?php

namespace App\Http\Requests;

use App\Services\Bookkeeping\YearDatabaseDiscovery;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class SyncYearRequest extends FormRequest
{
    /**
     * Determine if the user is authorized to make this request.
     */
    public function authorize(): bool
    {
        return true;
    }

    /**
     * Get the validation rules that apply to the request.
     *
     * @return array<string, \Illuminate\Contracts\Validation\ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        /** @var YearDatabaseDiscovery $yearDatabaseDiscovery */
        $yearDatabaseDiscovery = app(YearDatabaseDiscovery::class);

        return [
            'year' => [
                'required',
                'integer',
                Rule::in($yearDatabaseDiscovery->discover()->pluck('year')->all()),
            ],
        ];
    }

    protected function prepareForValidation(): void
    {
        $this->merge([
            'year' => $this->route('year'),
        ]);
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'year.in' => 'Das gewählte Jahr wurde nicht als Datenquelle gefunden.',
        ];
    }
}
